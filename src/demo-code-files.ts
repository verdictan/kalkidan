import {
  cleanCodePath,
  codeFileLimits,
  type CodeFilesAPI,
  type CodeSearchMatch,
} from './domain/code-files';

// The browser preview has one small repository. Each folder gets its own copy, so a save in
// one chat does not change another folder.
const signInSpec = `import { test, expect } from '@playwright/test';
import { expiredSession } from './fixtures';

test.describe('sign in', () => {
  test('expired session goes to sign in', async ({ page }) => {
    await page.context().addCookies([expiredSession]);
    await page.goto('/projects');
    await expect(page).toHaveURL(/\\/sign-in/);
  });

  test('SSO redirect keeps the return path', async ({ page }) => {
    await page.goto('/sso/callback?state=abc&next=/billing');
    await expect(page).toHaveURL('/billing');
  });
});`;

const files: Record<string, string> = {
  'README.md': '# atlas-web\n\nThe customer app of Atlas.\n\n```sh\nnpm run dev\n```\n',
  'package.json': `{
  "name": "atlas-web",
  "private": true,
  "scripts": {
    "dev": "vite",
    "test": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "1.64.1"
  }
}
`,
  'playwright.config.ts': `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  use: { baseURL: 'http://127.0.0.1:5173' },
  webServer: { command: 'npm run dev', port: 5173, reuseExistingServer: true },
});
`,
  'src/auth/session.ts': `export interface Session {
  userId: string;
  expiresAt: number;
}

export const sessionCookie = 'atlas_session';

export function isExpired(session: Session, now = Date.now()) {
  return session.expiresAt <= now;
}

export function readSession(cookie: string | undefined): Session | null {
  if (!cookie) return null;
  try {
    return JSON.parse(atob(cookie)) as Session;
  } catch {
    return null;
  }
}
`,
  'src/auth/session-store.ts': `import { readSession, type Session } from './session';

class SessionStore {
  private current: Session | null = null;

  load(cookie: string | undefined) {
    this.current = readSession(cookie);
    return this.current;
  }

  clear() {
    this.current = null;
  }
}

export const sessionStore = new SessionStore();
`,
  'src/auth/sign-in.ts': `import { isExpired, readSession } from './session';

export function needsSignIn(cookie: string | undefined) {
  const session = readSession(cookie);
  return !session || isExpired(session);
}

export function signInUrl(returnPath: string) {
  return '/sign-in?next=' + encodeURIComponent(returnPath);
}
`,
  'src/auth/sso.ts': `export function returnPath(search: string) {
  const next = new URLSearchParams(search).get('next');
  return next && next.startsWith('/') ? next : '/projects';
}
`,
  'src/routes/projects.tsx': `export function Projects() {
  return <h1>Projects</h1>;
}
`,
  'src/routes/billing.tsx': `export function Billing() {
  return <h1>Billing</h1>;
}
`,
  'tests/auth/fixtures.ts': `export const expiredSession = {
  name: 'atlas_session',
  value: btoa(JSON.stringify({ userId: 'u1', expiresAt: 0 })),
  url: 'http://127.0.0.1:5173',
};
`,
  'tests/auth/sign-in.spec.ts': signInSpec,
  'tests/fixtures/expired-session.json': '{ "userId": "u1", "expiresAt": 0 }\n',
  'tsconfig.json': '{\n  "compilerOptions": { "strict": true, "jsx": "react-jsx" }\n}\n',
};
// The files that the demo agent wrote in this chat. They are new, so all their lines changed.
const agentFiles = new Set([
  'tests/auth/sign-in.spec.ts',
  'playwright.config.ts',
  'tests/auth/fixtures.ts',
]);

const folders = new Map<string, Map<string, string>>();
function folder(cwd: string) {
  let entry = folders.get(cwd);
  if (!entry) {
    entry = new Map(Object.entries(files));
    folders.set(cwd, entry);
  }
  return entry;
}

function revisionOf(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0') + ':' + text.length;
}

function path(value: string) {
  const clean = cleanCodePath(value);
  if (!clean) throw new Error('The file is outside the repository.');
  return clean;
}

export const demoCodeFiles: Required<CodeFilesAPI> = {
  codeFiles: async (cwd) => ({ files: [...folder(cwd).keys()].sort(), truncated: false }),
  codeFileRead: async (cwd, value) => {
    const file = path(value);
    const text = folder(cwd).get(file);
    if (text === undefined) throw new Error('The file is not found.');
    return { path: file, size: text.length, revision: revisionOf(text), content: text };
  },
  codeFileWrite: async (cwd, value, content, expectedRevision) => {
    const file = path(value);
    const current = folder(cwd).get(file);
    if (current === undefined) return { ok: false, conflict: true, revision: null };
    if (revisionOf(current) !== expectedRevision)
      return { ok: false, conflict: true, revision: revisionOf(current) };
    if (content.length > codeFileLimits.writeBytes)
      throw new Error('The file is too large to save here.');
    folder(cwd).set(file, content);
    return { ok: true, revision: revisionOf(content), size: content.length };
  },
  codeFileRevision: async (cwd, value) => {
    const text = folder(cwd).get(path(value));
    return text === undefined ? null : revisionOf(text);
  },
  codeFileChanges: async (cwd, value) => {
    const file = path(value);
    const text = folder(cwd).get(file) ?? '';
    const count = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    const lines = agentFiles.has(file) ? Array.from({ length: count }, (_, i) => i + 1) : [];
    return { path: file, lines, untracked: agentFiles.has(file) };
  },
  codeSearch: async (cwd, query) => {
    const text = query.trim() ? query : '';
    if (!text) throw new Error('Type the text to find.');
    const ignoreCase = text === text.toLowerCase();
    const needle = ignoreCase ? text.toLowerCase() : text;
    const matches: CodeSearchMatch[] = [];
    for (const [file, content] of [...folder(cwd)].sort(([a], [b]) => a.localeCompare(b)))
      content.split('\n').forEach((line, index) => {
        const column = (ignoreCase ? line.toLowerCase() : line).indexOf(needle);
        if (column >= 0)
          matches.push({ path: file, line: index + 1, column: column + 1, text: line });
      });
    return { matches: matches.slice(0, codeFileLimits.matches), truncated: false };
  },
};
