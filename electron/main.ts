import { app, BrowserWindow, dialog, ipcMain, shell, Menu } from 'electron';
import { readFile, writeFile, rename, mkdir, stat, realpath } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as TOML from '@iarna/toml';
import type { Project, Agent } from '../src/types';
import { exec, launchCommand, parseWorktrees } from './core';
import { history } from './history';
// Development tests use an isolated library without touching personal app data.
if (!app.isPackaged && process.env.COMMON_GROUND_TEST_DATA) app.setPath('userData', process.env.COMMON_GROUND_TEST_DATA);
let projects: Project[] = []; let win: BrowserWindow;
const dev = process.argv.includes('--dev');
const codexRoot = process.env.CODEX_HOME || join(homedir(), '.codex');
const claudeRoot = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
let saves = Promise.resolve();
async function save() {
  const data = JSON.stringify(projects, null, 2);
  const task = saves.catch(() => {}).then(async () => {
    const file = join(app.getPath('userData'), 'projects.json');
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(file + '.tmp', data, { mode: 0o600 }); await rename(file + '.tmp', file);
  }); saves = task; await task;
}
function project(id: string) { const p = projects.find(p => p.id === id); if (!p) throw new Error('Project not found'); return p; }
async function addPath(path: string) {
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isDirectory()) throw new Error('Choose a folder');
  if (projects.some(p => p.path === canonical)) return false;
  projects.push({ id: randomUUID(), name: basename(canonical), path: canonical, notes: '', favorite: false, addedAt: new Date().toISOString() });
  return true;
}
function handle(channel: string, fn: (...args: any[]) => any) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted caller');
    return fn(...args);
  });
}
async function git(path: string, args: string[]) { return (await exec('git', ['-C', path, ...args], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 })).stdout; }
app.whenReady().then(async () => {
  try {
    const data = JSON.parse(await readFile(join(app.getPath('userData'), 'projects.json'), 'utf8'));
    if (!Array.isArray(data) || !data.every(p => typeof p.id === 'string' && typeof p.path === 'string' && typeof p.name === 'string' && typeof p.notes === 'string' && typeof p.favorite === 'boolean')) throw new Error('Invalid project library');
    projects = data;
  } catch (error: any) { if (error.code !== 'ENOENT') { dialog.showErrorBox('Cannot load project library', 'Your project library could not be read. The app will close to avoid overwriting it. ' + error.message); app.quit(); return; } }
  handle('snapshot', async () => ({ projects, ...await history(codexRoot, claudeRoot), platform: process.platform }));
  handle('add', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'multiSelections'], buttonLabel: 'Add projects' }); if (!r.canceled) { for (const path of r.filePaths) await addPath(path); await save(); } });
  handle('discover', async () => {
    const { sessions } = await history(codexRoot, claudeRoot); const paths = new Set(sessions.map(s => s.cwd));
    try { const config = TOML.parse(await readFile(join(codexRoot, 'config.toml'), 'utf8')); for (const path of Object.keys(config.projects || {})) paths.add(path); } catch { /* History remains available without a config. */ }
    let added = 0;
    for (const path of paths) { try { if (await addPath(path)) added++; } catch { /* Ignore missing historical folders. */ } }
    await save(); return { added };
  });
  handle('update', async (id, changes) => {
    const p = project(id);
    if (typeof changes.name === 'string') { if (!changes.name.trim() || changes.name.length > 150) throw new Error('Name must contain 1–150 characters'); p.name = changes.name.trim(); }
    if (typeof changes.notes === 'string') { if (changes.notes.length > 20000) throw new Error('Notes are too long'); p.notes = changes.notes; }
    if (typeof changes.favorite === 'boolean') p.favorite = changes.favorite;
    await save();
  });
  handle('remove', async id => { project(id); projects = projects.filter(p => p.id !== id); await save(); });
  handle('git', async id => {
    const p = project(id); await stat(p.path);
    try { await git(p.path, ['rev-parse', '--show-toplevel']); } catch (error: any) { if (error.stderr?.includes('not a git repository')) return null; throw error; }
    const [branch, status, trees] = await Promise.all([git(p.path, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'unborn'), git(p.path, ['status', '--porcelain', '-z']), git(p.path, ['worktree', 'list', '--porcelain'])]);
    const entries = status.split('\0'); let changes = 0;
    for (let i = 0; i < entries.length; i++) { if (entries[i]) { changes++; if (/^[RC]|^.[RC]/.test(entries[i])) i++; } }
    return { branch: branch.trim(), changes, worktrees: parseWorktrees(trees) };
  });
  handle('reveal', async id => { const result = await shell.openPath(project(id).path); if (result) throw new Error(result); });
  handle('launch', async (id: string, agent: Agent | 'terminal', sessionId?: string) => {
    const p = project(id); await stat(p.path);
    if (process.platform !== 'darwin') throw new Error('Launching Terminal is available on macOS. Build or run this app on your Mac.');
    if (sessionId) { const { sessions } = await history(codexRoot, claudeRoot); if (!sessions.some(s => s.id === sessionId && s.agent === agent && s.cwd === p.path)) throw new Error('Session does not belong to this project'); }
    const command = launchCommand(p.path, agent, sessionId);
    await exec('/usr/bin/osascript', ['-e', `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(command)}\nend tell`], { timeout: 15000 });
  });
  handle('worktree', async (id, branch) => {
    const p = project(id);
    if (typeof branch !== 'string' || branch.startsWith('-') || branch.length > 200) throw new Error('Enter a valid new branch name');
    await git(p.path, ['check-ref-format', '--branch', branch]);
    const r = await dialog.showSaveDialog(win, { title: 'Choose a location for the new worktree', defaultPath: join(p.path, '..', basename(p.path) + '-' + branch.replaceAll('/', '-')), buttonLabel: 'Create worktree' });
    if (r.canceled || !r.filePath) return false;
    await git(p.path, ['worktree', 'add', '-b', branch, '--', r.filePath]); await addPath(r.filePath); await save(); return true;
  });
  function createWindow() {
    win = new BrowserWindow({ width: 1360, height: 900, minWidth: 980, minHeight: 680, title: 'Common Ground', backgroundColor: '#f6f7f9', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 22 }, webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const url = dev ? 'http://127.0.0.1:5173' : pathToFileURL(join(__dirname, '../dist/index.html')).href;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, target) => { if (target !== url) event.preventDefault(); });
    win.loadURL(url);
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
  createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
