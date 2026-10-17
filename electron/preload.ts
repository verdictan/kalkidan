import { contextBridge, ipcRenderer } from 'electron';
import type { API } from '../src/types';
const api: API = {
  snapshot: () => ipcRenderer.invoke('snapshot'), add: () => ipcRenderer.invoke('add'),
  discover: () => ipcRenderer.invoke('discover'), update: (id, changes) => ipcRenderer.invoke('update', id, changes),
  remove: id => ipcRenderer.invoke('remove', id), git: id => ipcRenderer.invoke('git', id),
  launch: (id, agent, sessionId) => ipcRenderer.invoke('launch', id, agent, sessionId),
  reveal: id => ipcRenderer.invoke('reveal', id), worktree: (id, branch) => ipcRenderer.invoke('worktree', id, branch)
};
contextBridge.exposeInMainWorld('workspace', api);
