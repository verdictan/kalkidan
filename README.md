<div align="center">

# Kalkidan

**Your projects. Your agents. One place to keep building.**

A macOS app for organizing repositories, continuing Codex and Claude Code conversations,<br />
and managing project work through GitHub Projects.

![Platform: macOS](https://img.shields.io/badge/platform-macOS-18181b?style=flat-square)
![Built with TypeScript](https://img.shields.io/badge/built_with-TypeScript-3178c6?style=flat-square)
[![License: MIT](https://img.shields.io/badge/license-MIT-18181b?style=flat-square)](LICENSE)

[Get started](#get-started) · [The workflow](#the-workflow) · [GitHub Projects](#github-projects) · [Contributing](#contributing)

</div>

![Kalkidan showing project navigation and an in-app Codex conversation](docs/images/conversation.png)

<p align="center"><sub>Actual interface, shown with sample data in browser preview mode.</sub></p>

## Keep the work together

A project can span a frontend, an API, shared packages, and dozens of agent conversations. Kalkidan brings them into one project view, so you can find the right repository, pick up a session, and keep its tasks close by.

- **One tracker, related repositories.** Connect each project to a GitHub Project and keep its work in the repositories that belong to it. Add local folders or browse and clone GitHub repositories from the app.
- **Codex and Claude Code, in the same interface.** Start or resume conversations with streaming responses, model selection, expandable tool output and changes, and in-app permission approvals.
- **Sessions you can find again.** Search, rename, pin, collect, annotate, and archive conversations without rewriting their provider history.
- **A tracker connected to the work.** Use a compact tracker inspired by Linear: status columns and repository filters. Move tasks between statuses and open them with an agent. Repository overviews also show the linked project board beside the repository’s session controls.
- **Room to focus.** Use a dark desktop interface with project navigation, pinned conversations, and a focused reading area. Switch between project management and conversations. Open tabs retain drafts and running responses while you navigate.
- **Git close at hand.** Inspect branches and changes, view worktrees, or create a branch and worktree for independent work.

Built with TypeScript, Electron, React, Tailwind CSS, and shadcn/ui.

## Get started

Kalkidan is in early development. Run it from source, or build a macOS installer locally.

### Prerequisites

| Requirement | Used for |
| --- | --- |
| macOS | Desktop app and native integrations |
| Node.js **22.12+** and npm | Installing dependencies and running the app |
| Git | Repository status and worktrees |
| Codex CLI and/or Claude Code CLI | Conversations with the agents you use |
| GitHub CLI (`gh`) | Required to connect or create projects; also handles repository browsing and cloning |

Sign in to each agent CLI you want to use and verify that `codex` or `claude` runs in your shell. Kalkidan uses that installation and its existing authentication.

```sh
git clone https://github.com/verdictan/kalkidan.git
cd kalkidan
npm ci
npm run dev
```

### Your first project

1. Choose **New project**, and select or create its GitHub Project.
2. Use **Add repositories** to select local folders or clone from GitHub. Every repository belongs to a project.
3. Select a repository and start a **Codex** or **Claude Code** conversation, or expand the repository to resume an existing session.
4. Choose a model and permission mode, write your message, and press **⌘ Enter**.
5. Open a tracker task to start work in the current checkout or a new worktree. General conversations can stay unlinked; use **Link task** to attach context later.

Want to explore the interface first? Run `npm run preview` and open `http://127.0.0.1:5173`. This is a browser preview with sample data; native actions require the desktop app.

## Remote projects over SSH

Keep Kalkidan on your Mac and run repositories, Codex, and Claude Code on a remote Linux or macOS host.

1. In **New project**, set **Where work runs** to **Remote SSH host**.
2. Add an SSH config alias or `user@hostname`, then choose **Check connection**.
3. Choose **Install agent & connect**. Kalkidan uploads its bundled agent into `~/.local/share/kalkidan/agents/` on the host and starts it over SSH.
4. Connect or create the project's GitHub Project as usual.
5. Use **Add repositories** to browse remote folders or clone a GitHub repository into an absolute path on the host.

The host needs Node.js **22+**, Git, and the agent CLIs you use, available on the noninteractive SSH shell's PATH. Configure key-based authentication and verify the host key with your normal SSH client first. Custom ports, identity files, and jump hosts belong in `~/.ssh/config`. Password prompts and new host-key confirmations are not handled inside Kalkidan.

The connection uses OpenSSH with strict host-key checking. Agent installation does not require sudo or expose a public server port. Codex and Claude use their own credentials and settings on the host; private repository cloning requires Git credentials there too. GitHub Projects authorization stays on the Mac.

Remote session history, conversations, approvals, commands, worktrees, and Git diffs use the selected host. Identical folder paths on different hosts remain separate. Remote projects show an SSH label; offline requests fail explicitly rather than running on the Mac.

Manage saved connections in **Settings → Remote hosts**. Reconnect after restarting the app. Disconnecting, updating the remote agent, or closing Kalkidan stops active remote work; the agent is not a persistent background service. Saved provider history remains on the host.

Browser previews run on the Mac. Use a URL reachable from the Mac, or configure SSH port forwarding yourself for a remote development server. Automatic port forwarding is not included.

## The workflow

```text
Project
├── Repository
│   ├── Codex sessions
│   └── Claude Code sessions
├── Another repository
│   └── More sessions
└── Connected GitHub Project
    └── Tasks linked to agent sessions
```

**Projects organize the work.** A project groups related repository folders around a GitHub Project. Existing unlinked projects stay accessible with a prompt to connect. Each repository has its own Git state, worktrees, and conversations. There is no extra workspace layer to manage.

**Conversations stay in Kalkidan.** Select a session from its repository to continue with the original agent. Model choices include the agent default, available provider options, and a custom model ID. Agents share repository files while keeping their own conversation context, configuration, and credentials.

**You control edits.** Conversations default to **Read only**. Choose **Allow project edits** when you want the agent to change files. Existing agent rules and settings still apply. When the provider requests command, file, or tool permissions, an approval card offers **Allow once** or **Deny**. Codex permission grants that last for the turn are explicitly labeled **Allow for this turn**. Unanswered requests expire when their turn stops or ends. Unsupported interactive request types are declined.

**Bring evidence into a conversation.** The titlebar’s **Terminal**, **Browser**, and **Git diff** buttons open a tools pane beside the chat. Drag the divider to resize it, use its arrow keys for smaller adjustments, or double-click to reset. The chat, composer, and draft stay visible while you work. The tools pane has browser-style tabs: use **+** (⌘T) to add independent terminals, browser pages, or changes views; close tabs individually, or hide the pane without ending its sessions. Use ⌘` for Terminal and ⌘⇧G for Changes. Attach terminal output, Git diffs, or page annotations as removable context; nothing is sent to the agent until you send the message.

The embedded Chromium browser includes back/forward navigation, reload, element annotations, find in page, page zoom, a device toolbar with presets and custom dimensions, PNG screenshots, and the native print dialog. Links that request another window open in a new tool tab. Its **⋯** menu also manages downloads, searchable history, the home page, history recording, and clearing cache, cookies/site data, or saved passwords. Browser data stays in Kalkidan’s separate profile.

Import cookies from a JSON array and passwords from a Chrome/Firefox-style CSV with `url`, `username`, and `password` columns. Passwords are encrypted using the operating system’s secure storage. Choose **Fill login** for a saved credential on its exact origin; the app fills the visible form but does not submit it. Direct import of Chrome’s protected profile, Chrome Sync, and automatic capture of new passwords are not included.

These tools require the Electron desktop app. The interactive terminal uses xterm.js and a real pseudo-terminal. It requires Python 3 on the execution machine (your Mac or the selected SSH host), using only its standard library. Shell state persists until you choose New shell, close the conversation tab, disconnect the host, or quit the app. Browser annotations capture text, selectors, URLs, and element bounds rather than screenshots. Commands and browser previews close when the app window closes.

**Navigation keeps your place.** Collapse the project tree to focus, use **⌘K** to search, and switch between project details and conversations. Drafts and running responses survive switching views within the app. Closing the app window stops active responses; saved provider history remains available.

Use a repository's **Sessions** tab to manage titles, pins, collections, notes, and archives. Archiving in Kalkidan hides a conversation locally without deleting the provider's history.

## GitHub Projects

Connect a project to a GitHub Projects v2 board on **github.com**. Choose an existing board from your account or organization, create one, or connect by URL.

If authorization is needed, Kalkidan starts the GitHub CLI sign-in or scope-refresh flow, opens GitHub in your browser, and shows the device code in the app. GitHub CLI manages the credentials.

Once connected, you can:

- Open a project directly to its **Board**, search tasks, and filter by status or repository.
- Drag cards between columns or change status with a keyboard-accessible selector.
- Create draft items and add existing issues or pull requests.
- Choose **Work on this**, select a repository and agent, and review the task prompt before sending it.
- Resume sessions linked to a task.

A linked task moves to **In progress** when its agent starts responding. After a successful response, Kalkidan asks before marking it **Done**. Those transitions require matching status options on the board. Task changes sync to GitHub. Use **GitHub project** at the bottom of the sidebar to replace a connection; linked projects cannot be disconnected into local-only projects.

<details>
<summary>See the tracker board</summary>

![Kalkidan tracker board with Todo, In progress, and Done columns](docs/images/tracker-board.png)


*Shown with sample data.*

</details>

## Local data and privacy

Kalkidan has no hosted backend. It stores project and session organization on your Mac. Agent operations use installed CLIs on the selected machine, while GitHub project operations use the Mac’s GitHub CLI. Those tools connect to their respective services using your existing accounts.

When you send a task-linked message, the selected agent receives the task description, project name, member repository paths, and linked GitHub Project URL alongside your prompt.

<details>
<summary>Storage and session discovery</summary>

App metadata lives in Electron's user-data directory, normally `~/Library/Application Support/kalkidan/`:

| File | Contents |
| --- | --- |
| `remote-hosts.json` | Saved SSH host profiles and installed agent versions; no SSH credentials |
| `projects.json` | Registered repository folders and metadata |
| `project-groups.json` | Project groupings and GitHub Project connections |
| `sessions.json` | Session titles, pins, collections, notes, archives, and task links |

Existing installations can reuse a previous `common-ground` or `Common Ground` data directory. Removing a repository from the library does not delete its files.

Session discovery reads Codex's local SQLite index with a JSONL fallback, and Claude Code's local project conversation files. It respects `CODEX_HOME` and `CLAUDE_CONFIG_DIR`, which default to `~/.codex` and `~/.claude`. There is no session-count cap. Source-archived Codex threads and Claude subagent logs are excluded; sessions archived in Kalkidan are hidden from the active list.

These readers adapt to local provider storage formats, so unsupported metadata may prevent a session from appearing. Resuming requires its working folder to exist. JSONL transcript previews read up to the last 4 MiB and show up to 500 user/assistant messages; tool results and internal reasoning are omitted. Preview limits do not replace the context used by the agent when resuming.

The Electron renderer is sandboxed and context isolated, with no direct Node.js access. Native operations run through a typed preload bridge.

</details>

## Development

```sh
npm run dev             # Start Vite and Electron
npm run build           # Type-check and build the renderer and desktop app
npm test                # Unit and integration fixtures
npx playwright install chromium
npm run test:ui         # Browser interaction tests
npm run test:desktop    # Electron IPC and persistence smoke test
npm run dist:mac        # Build macOS DMG and ZIP into release/
```

Renderer changes hot reload. Restart `npm run dev` after changing files under `electron/`.

Codex uses [App Server](https://developers.openai.com/codex/app-server) for streaming turns and approvals. Claude Code uses its bidirectional stream-JSON control protocol, following the [official Agent SDK transport](https://github.com/anthropics/claude-agent-sdk-python/tree/main/src/claude_agent_sdk/_internal). Both use installed CLI authentication.

Tests use sample data, fixture executables, temporary directories, and simulated SSH transport. Remote checks do not validate a live SSH server or deployment. They do not validate a live authenticated agent turn or mutate live GitHub Projects. Packaging runs on macOS; signed and notarized distribution requires your own signing configuration. Local builds are unsigned unless you configure it.

```text
electron/             Native operations, agent processes, GitHub, persistence
src/components/       Projects, repositories, conversations, and tracker views
src/components/ui/    Shared shadcn/ui components
src/demo.ts           Browser preview adapter with sample data
src/types.ts          Shared renderer and desktop API types
tests/                Unit, browser, and Electron checks
```

## Troubleshooting

<details>
<summary>Development server: port 5173 is already in use</summary>

The development command expects Vite at `127.0.0.1:5173`. Stop the previous Kalkidan development process, or the other server using that port, then run `npm run dev` again.

</details>

<details>
<summary>Codex reports “already has an active writer”</summary>

Codex allows one writer per session. Stop the task and close that session in the client that owns it; an idle session in another app can still hold the lock. If needed, quit the owning client, then choose **Retry session** in Kalkidan. Kalkidan restores the unsent message so you can try again. It does not claim to identify the owning client when Codex does not report it.

</details>

<details>
<summary>GitHub Projects needs additional access</summary>

Use the authorization action in Kalkidan to grant Projects access through your browser. If you prefer to authorize manually:

```sh
gh auth login
gh auth refresh -h github.com -s project
```

Your account must also have access to the repository or organization project you want to use.

</details>

<details>
<summary>Node or Electron does not start</summary>

Check that your shell uses Node.js 22.12 or newer. For Homebrew's `node@22` on Apple Silicon:

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
```

If your package manager skipped Electron's installation script, allow its postinstall or run:

```sh
node node_modules/electron/install.js
```

</details>

Current scope excludes cloud-only sessions, cross-agent conversation conversion, worktree removal, GitHub Enterprise, and classic GitHub Projects. The explicit **Terminal** repository shortcut opens macOS Terminal; agent conversations run inside Kalkidan.

## Contributing

Issues and pull requests are welcome. For larger changes, open an issue first to discuss the intended workflow.

Include reproduction steps, your macOS and CLI versions, and relevant logs when reporting a bug. Remove credentials and private repository or conversation content before posting. For UI changes, include screenshots; for behavior changes, add focused coverage and run the relevant checks above.

## License

[MIT](LICENSE) · Copyright © 2026 Verdictan.com

### Conversation actions

The conversation’s titlebar menu supports rename, pin/unpin, a separate side chat,
archive, and native forks into the current checkout or a new Git worktree. Forks
inherit the provider’s saved conversation and receive a new session ID on the first
message. Send a draft’s first message before exporting, scheduling, or forking it.
Archiving hides a conversation in Kalkidan; restore it from the repository’s archived sessions.

**Share** exports Markdown or a standalone HTML file using the macOS save dialog.
HTML exports escape conversation content. Exports contain the transcript available
to Kalkidan and indicate when earlier content was truncated. No public link is created.
The Copy submenu copies the transcript, session ID, or repository path. Saved chats
can open in another Kalkidan window; local repositories can open in Finder, VS Code,
or Cursor (the selected editor must be installed). Remote folders stay on their SSH host.

**Scheduled tasks** run once, in read-only mode, while a Kalkidan window is open.
Choose a local date/time and prompt from **Add scheduled task…**. The calendar button
in the titlebar opens the task list and shows a badge for missed runs, failures, and
approval requests. Approve or deny requests there, stop a running task, cancel a pending
task, or explicitly run a missed task. Tasks missed while the app is closed or the Mac
is asleep are not silently replayed. SSH tasks require their host to remain connected.
Scheduled prompts and their latest results are stored locally in the app’s data folder.
