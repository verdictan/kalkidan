import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export function dataDirectory(home: string, appData: string, testDirectory?: string) {
  // Tests must never inspect or migrate the user's real library.
  if (testDirectory) {
    mkdirSync(testDirectory, { recursive: true, mode: 0o700 });
    return testDirectory;
  }
  const destination = join(home, '.kalkidan');
  if (existsSync(destination)) return destination;
  const previous = ['kalkidan', 'common-ground', 'Common Ground']
    .map((name) => join(appData, name))
    .find((path) => existsSync(path));
  if (previous) {
    // Rename the whole profile before Electron opens it. If migration fails,
    // leave the source intact and fail rather than opening an empty library.
    renameSync(previous, destination);
  } else {
    mkdirSync(destination, { recursive: true, mode: 0o700 });
  }
  return destination;
}
