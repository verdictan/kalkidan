import {
  parseWindowScope,
  projectWindowQuery,
  toolInstallUrls,
  toolNames,
  type ComputerTools,
  type DesktopAPI,
  type SubagentSession,
  type ToolStatus,
} from './domain/desktop';

/** The browser demo of the desktop functions: project windows, tools and subagents. */

const windowsKey = 'kalkidan.demo.projectWindows';
const toolsKey = 'kalkidan.demo.tools';

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage is not available. */
  }
}
function openWindows(): string[] {
  try {
    const value = JSON.parse(read(windowsKey) || '[]');
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

// A project window of the demo adds its project to the list while it is open.
if (typeof window !== 'undefined') {
  const scope = parseWindowScope(window.location.search);
  if (scope.kind === 'project') {
    const add = () =>
      write(windowsKey, JSON.stringify([...new Set([...openWindows(), scope.groupId])]));
    add();
    window.addEventListener('pagehide', () =>
      write(windowsKey, JSON.stringify(openWindows().filter((id) => id !== scope.groupId))),
    );
  }
}

function tool(
  id: ToolStatus['tool'],
  version: string | undefined,
  extra: Partial<ToolStatus> = {},
): ToolStatus {
  const agent = id !== 'gh';
  return {
    tool: id,
    name: toolNames[id],
    kind: agent ? 'agent' : 'github',
    state: version ? 'ready' : 'missing',
    installed: !!version,
    ...(version ? { version, path: `/opt/homebrew/bin/${id}` } : {}),
    signedIn: version ? 'yes' : 'unknown',
    access: version ? 'granted' : 'unknown',
    usable: agent && !!version,
    installUrl: toolInstallUrls[id],
    ...extra,
  };
}

/** `localStorage['kalkidan.demo.tools']`: 'all' (all ready), 'none' (no agents), else one missing. */
function demoTools(): ToolStatus[] {
  const mode = read(toolsKey);
  const gh = tool('gh', '2.62.0', { account: 'dana-kim' });
  if (mode === 'all') return [tool('claude', '2.0.14'), tool('codex', '0.46.0'), gh];
  if (mode === 'none') return [tool('claude', undefined), tool('codex', undefined), gh];
  return [tool('claude', '2.0.14'), tool('codex', undefined), gh];
}

function localTools(): ComputerTools {
  return {
    computer: 'local',
    name: 'This Mac',
    connected: true,
    tools: demoTools(),
    checkedAt: new Date().toISOString(),
  };
}

/** The subagents of the demo session "Refine project and repository navigation". */
export const demoSubagents: SubagentSession[] = [
  { id: 'demo-sub-explore', title: 'Explore auth module', status: 'running', type: 'Explore' },
  { id: 'demo-sub-tests', title: 'Run the test suite', status: 'done' },
];

const toolListeners = new Set<(computer: ComputerTools) => void>();

export const demoDesktop: Required<DesktopAPI> = {
  openProjectWindow: async (groupId) => {
    window.open(window.location.origin + window.location.pathname + projectWindowQuery(groupId));
  },
  projectWindows: async () => openWindows(),
  onProjectWindowsChange: (callback) => {
    const listener = (event: StorageEvent) => {
      if (event.key === windowsKey) callback(openWindows());
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  },
  computerTools: async () => [
    localTools(),
    {
      computer: 'build-server',
      name: 'build-server',
      connected: true,
      tools: [tool('claude', undefined), tool('codex', '0.46.0'), tool('gh', '2.62.0')],
      checkedAt: new Date().toISOString(),
    },
  ],
  toolStatus: async (computer, options) => {
    const result =
      !computer || computer === 'local'
        ? localTools()
        : (await demoDesktop.computerTools()).find((item) => item.computer === computer);
    if (!result) throw new Error('Computer not found.');
    if (options?.fresh) toolListeners.forEach((listener) => listener(result));
    return result;
  },
  onToolsChange: (callback) => {
    toolListeners.add(callback);
    return () => toolListeners.delete(callback);
  },
  restartApp: async () => window.location.reload(),
  gatewayRuntime: async () => ({ state: 'ready' }),
  gatewayRuntimeRetry: async () => ({ state: 'ready' }),
};
