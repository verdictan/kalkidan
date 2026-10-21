import { access, chmod, copyFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { spawn } from 'node:child_process';
import type { DesktopInstall, DesktopInstallKind } from '../../src/domain/updates';
import { exec } from '../core';

export const desktopBundleId = 'dev.kalkidan.desktop';

/** Where the running copy is installed, and what the updater must replace. */
export interface DesktopInstallation extends DesktopInstall {
  /** The `.app` bundle, the AppImage file, or the Windows installation folder. */
  target?: string;
  /** The release asset suffix after `Kalkidan-<version>-`. */
  asset?: string;
}
export interface InstallEnvironment {
  platform: string;
  arch: string;
  execPath: string;
  packaged: boolean;
  env: NodeJS.ProcessEnv;
}
const manual = (kind: DesktopInstallKind, reason: string, asset?: string): DesktopInstallation => ({
  kind,
  selfUpdate: false,
  reason,
  asset,
});
async function writable(...paths: string[]) {
  try {
    for (const path of paths) await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds the install kind. Only kinds that can replace themselves without a new signing
 * requirement, a package manager, or administrator rights can update in the app.
 */
export async function detectInstallation(value: InstallEnvironment): Promise<DesktopInstallation> {
  if (!value.packaged) return manual('development', 'Development builds do not update themselves.');
  if (!['arm64', 'x64'].includes(value.arch))
    return manual('unsupported', 'No Kalkidan release is published for this processor.');
  if (value.platform === 'darwin') {
    const asset = `mac-${value.arch}.zip`;
    const match = /^(.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(value.execPath);
    if (!match) return manual('unsupported', 'Kalkidan cannot find its application bundle.');
    const target = match[1];
    if (target.includes('/AppTranslocation/'))
      return manual(
        'mac-app',
        'macOS runs this copy from a temporary read-only location. Move Kalkidan to the Applications folder, open it again, and then update.',
        asset,
      );
    if (target.startsWith('/Volumes/') && !(await writable(dirname(target))))
      return manual(
        'mac-app',
        'Kalkidan runs from the disk image. Copy Kalkidan to the Applications folder, open it from there, and then update.',
        asset,
      );
    if (!(await writable(dirname(target), target)))
      return manual(
        'mac-app',
        'Your user account cannot replace Kalkidan in its folder. Install the download yourself, or move Kalkidan to a folder that you can change.',
        asset,
      );
    return { kind: 'mac-app', selfUpdate: true, target, asset };
  }
  if (value.platform === 'win32') {
    if (value.arch !== 'x64')
      return manual('unsupported', 'No Kalkidan release is published for this processor.');
    const folder = dirname(value.execPath);
    const installed = await stat(join(folder, 'Uninstall Kalkidan.exe')).then(
      (entry) => entry.isFile(),
      () => false,
    );
    if (!installed)
      return manual(
        'portable',
        'This copy runs from the ZIP download. Download the new ZIP file and replace this folder.',
        'win-x64.zip',
      );
    if (!(await writable(folder)))
      return manual(
        'windows-installer',
        'Kalkidan is installed for all users. Run the new installer as an administrator.',
        'win-x64.exe',
      );
    return { kind: 'windows-installer', selfUpdate: true, target: folder, asset: 'win-x64.exe' };
  }
  if (value.platform === 'linux') {
    if (value.arch !== 'x64')
      return manual('unsupported', 'No Kalkidan release is published for this processor.');
    const image = value.env.APPIMAGE;
    if (image && isAbsolute(image)) {
      const file = await stat(image).then(
        (entry) => entry.isFile(),
        () => false,
      );
      if (file && (await writable(dirname(image), image)))
        return { kind: 'appimage', selfUpdate: true, target: image, asset: 'linux-x64.AppImage' };
      return manual(
        'appimage',
        'Your user account cannot replace this AppImage file. Download the new AppImage and replace it yourself.',
        'linux-x64.AppImage',
      );
    }
    if (value.execPath.startsWith('/opt/Kalkidan/'))
      return manual(
        'deb',
        'Kalkidan was installed from a DEB package. Download the new DEB file and install it with your package manager.',
        'linux-x64.deb',
      );
    return manual(
      'unsupported',
      'Kalkidan cannot find how it was installed. Download the new release and install it yourself.',
    );
  }
  return manual('unsupported', 'No Kalkidan release is published for this operating system.');
}

/** Extracts the macOS ZIP and checks that it holds the expected Kalkidan bundle and version. */
export async function stageMacApp(zip: string, folder: string, version: string) {
  await rm(folder, { recursive: true, force: true });
  // ditto keeps the bundle symbolic links, modes, and extended attributes.
  await exec('/usr/bin/ditto', ['-x', '-k', zip, folder], { timeout: 300000 });
  const entries = (await readdir(folder)).filter((name) => name !== '__MACOSX');
  if (entries.length !== 1 || !entries[0].endsWith('.app'))
    throw new Error('The archive does not contain one application.');
  const app = join(folder, entries[0]);
  const plist = join(app, 'Contents', 'Info.plist');
  const read = async (key: string) =>
    (await exec('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])).stdout.trim();
  if ((await read('CFBundleIdentifier')) !== desktopBundleId)
    throw new Error('The archive contains a different application.');
  if ((await read('CFBundleShortVersionString')) !== version)
    throw new Error('The archive contains a different version.');
  const executable = await read('CFBundleExecutable');
  await access(join(app, 'Contents', 'MacOS', executable), constants.X_OK);
  return app;
}

/**
 * The macOS replacement script. It waits for this process to stop, swaps the bundles with
 * rename operations in the same folder, keeps the old bundle when a step fails, writes the
 * result, and opens the app that is in place.
 */
export const macApplyScript = `set -u
pid="$1"; staged="$2"; target="$3"; result="$4"; executable="$5"
backup="$(dirname "$target")/.$(basename "$target").previous"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i+1)); if [ "$i" -gt 600 ]; then echo "timeout" > "$result"; exit 1; fi
  sleep 0.2
done
rm -rf "$backup"
status=failed
if mv "$target" "$backup"; then
  if mv "$staged" "$target"; then status=installed; rm -rf "$backup"; else mv "$backup" "$target"; fi
fi
echo "$status" > "$result"
nohup "$target/Contents/MacOS/$executable" >/dev/null 2>&1 &
`;

export interface ApplyOptions {
  installation: DesktopInstallation;
  staged: string;
  result: string;
  pid: number;
  /** The running executable. The macOS script starts the same name in the new bundle. */
  execPath: string;
  quit(): void;
  relaunch(execPath: string): void;
  run?: typeof spawn;
}
/** Starts the platform installer for a verified, staged release. The app then quits. */
export async function applyStagedUpdate(options: ApplyOptions) {
  const { installation, staged } = options;
  const run = options.run || spawn;
  if (!installation.selfUpdate || !installation.target)
    throw new Error('This copy of Kalkidan cannot update itself.');
  await rm(options.result, { force: true });
  if (installation.kind === 'mac-app') {
    const executable = basename(options.execPath);
    const script = join(dirname(options.result), 'apply-update.sh');
    await writeFile(script, macApplyScript, { mode: 0o700 });
    const child = run(
      '/bin/sh',
      [script, String(options.pid), staged, installation.target, options.result, executable],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
    options.quit();
    return;
  }
  if (installation.kind === 'windows-installer') {
    // The NSIS installer replaces the per-user installation, then starts the new version.
    const child = run(staged, ['--updated', '/S', '--force-run'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    options.quit();
    return;
  }
  if (installation.kind === 'appimage') {
    // A rename in the same folder replaces the file. The running image stays mounted.
    const next = `${installation.target}.update`;
    await copyFile(staged, next);
    await chmod(next, 0o755);
    await rename(next, installation.target);
    await writeFile(options.result, 'installed\n');
    options.relaunch(installation.target);
    options.quit();
    return;
  }
  throw new Error('This copy of Kalkidan cannot update itself.');
}
