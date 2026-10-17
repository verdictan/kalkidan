# Common Ground

A local macOS desktop app for managing project folders shared by Codex and Claude Code. Built with TypeScript, Electron, React, and actual shadcn/ui components (Radix primitives and Tailwind CSS).

## Run on your Mac

Install Node.js 22.12 or newer, Git, and the Codex and Claude Code CLIs. Sign in to each CLI and verify that `codex` and `claude` run in Terminal.

```sh
npm ci
npm run dev
```

If your package manager blocks Electron's installation script, allow the Electron postinstall or run `node node_modules/electron/install.js` after installing dependencies.

Add existing folders with **Add project**, or use **Discover projects** to import existing paths from local session history and Codex configuration. Launch either agent from a project's overview. The app opens macOS Terminal in that folder using your existing shell environment and agent login. macOS may ask for permission to control Terminal.

```sh
npm run dist:mac
```

Run packaging on macOS. DMG and ZIP outputs go to `release/`. Configure electron-builder signing credentials for signed/notarized distribution; no signing identity is bundled. macOS packaging and Terminal automation still need to be validated on an actual Mac.

## Features

- Shared project library with search, favorites, names, notes, and Finder shortcuts.
- Launch Codex, Claude Code, or a plain Terminal in the selected folder.
- Discover existing folders from Codex `config.toml` project entries and both agents' local session metadata.
- Inspect Git branch, changed-file count, and existing worktrees.
- Create a new branch and worktree with a native destination picker; the worktree is added to the library automatically.
- View recent session titles, agent, time, and IDs; resume a session in its original CLI.
- Remove projects from the library without deleting their files.

The agents share the project files, not their conversation context, permissions, or credentials. Use separate worktrees when agents should work independently. Worktree removal, cloud sessions, embedded terminals, and cross-agent conversation conversion are not implemented.

## Local storage and history

Project metadata is stored in Electron's user-data directory as `projects.json` (normally `~/Library/Application Support/common-ground/` on macOS). Writes use a temporary file and rename. An unreadable library stops startup rather than overwriting it.

History is read from `$CODEX_HOME/sessions` (default `~/.codex/sessions`) and `$CLAUDE_CONFIG_DIR/projects` (default `~/.claude/projects`). This is a best-effort adapter for local JSONL files, not an official history API. Unknown and incomplete lines are skipped. It scans at most 5,000 files per agent, up to five directory levels, and reads the first 128 KiB of each of the 300 most recently modified files per agent. Session timestamps reflect file modification time. Missing or unsupported metadata may make a session unavailable. Archived Codex and cloud-only sessions are not included.

The manager has no network backend or API keys. Launched agents use their own normal connections and configuration. The Electron renderer is sandboxed, context isolated, and has no Node access; a narrow preload API handles native operations.

## Development and validation

```sh
npm run build           # Type-check, build renderer, bundle Electron
npm test                # Shell quoting, real Git worktrees, history fixtures
npx playwright install chromium
npm run test:ui         # Browser interaction test using labeled sample data
npm run test:desktop    # Real Electron IPC and persistence with temporary fixtures
npm run preview        # Browser-only preview at http://127.0.0.1:5173
```

The browser preview is explicitly labeled and uses sample data. Native actions require the desktop app. Tests do not launch authenticated agents or modify existing projects. Desktop smoke tests isolate the project library and agent stores in a temporary directory; on Linux they use Electron's headless platform.

The development command rebuilds Electron at startup. Restart it after changing files under `electron/`; renderer changes hot reload.

## Structure

- `electron/main.ts`: project persistence, validated IPC, native dialogs, Git, and Terminal launch.
- `electron/history.ts`: bounded local session readers.
- `electron/core.ts`: shell quoting and worktree parsing.
- `electron/preload.ts`: typed desktop bridge.
- `src/main.tsx`: project, session, and worktree interface.
- `src/components/ui/`: shadcn/ui components, editable in this repository.
- `src/demo.ts`: browser-only sample adapter.

References: [shadcn/ui for Vite](https://ui.shadcn.com/docs/installation/vite), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/), [macOS packaging](https://www.electron.build/v26/docs/mac/).
