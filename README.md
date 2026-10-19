<p align="center">
  <a href="https://github.com/verdictan/kalkidan">
    <img src="public/brand/kalkidan-mark.svg" alt="Kalkidan logo" width="160">
  </a>
</p>
<h1 align="center">Kalkidan</h1>
<p align="center">A desktop app for repositories, AI coding agents, and project tasks.</p>
<p align="center">
  <a href="https://github.com/verdictan/packages/releases?q=kalkidan"><img alt="Platforms: macOS, Windows, Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-18181b?style=flat-square"></a>
  <a href="https://github.com/verdictan/homebrew-tap"><img alt="Install with Homebrew" src="https://img.shields.io/badge/Homebrew-cask-FBB040?style=flat-square"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-18181b?style=flat-square"></a>
</p>
<p align="center">
  <a href="docs/user-guide.md">User guide</a> |
  <a href="docs/architecture.md">Architecture</a> |
  <a href="AGENTS.md">Contributor guide</a>
</p>

[![Kalkidan project navigation and a Codex conversation](docs/images/conversation.png)](docs/user-guide.md)

---

### Installation

```bash
# Install with Homebrew
brew install --cask verdictan/tap/kalkidan

# Update an existing installation
brew upgrade --cask kalkidan
```

> [!TIP]
> Install Git, GitHub CLI (`gh`), and the agent CLIs you will use. Sign in to each CLI before you start.

### Desktop App

Download an installer from the [releases page](https://github.com/verdictan/packages/releases?q=kalkidan).

| Platform | Download filename |
| --- | --- |
| macOS (Apple Silicon) | `Kalkidan-<version>-mac-arm64.dmg` |
| macOS (Intel) | `Kalkidan-<version>-mac-x64.dmg` |
| Windows (x64) | `Kalkidan-<version>-win-x64.exe` |
| Linux (x64) | `Kalkidan-<version>-linux-x64.AppImage` or `.deb` |

Each release also includes ZIP files and `SHA256SUMS.txt`. Replace `<version>` with the release version. Windows and macOS installers are unsigned. macOS installers are not notarized.

To run the source code, use Node.js and npm versions from `.node-version` and `package.json`:

```bash
git clone https://github.com/verdictan/kalkidan.git
cd kalkidan
npm ci
npm run dev
```

#### Project Directory

Select a project folder when you create a project. The default path is `~/.kalkidan/projects/<project-id>/`.

- `docs/` — Markdown documents.
- `repos/` — New repository clones.
- `worktrees/` — New Git worktrees.

Existing repositories stay at their original paths. App settings and session metadata use `~/.kalkidan/`. Remote projects store their project folders on the selected SSH host.

### Agents

Kalkidan uses your installed coding agents and their existing credentials.

- **Codex** — Start or continue Codex sessions with model selection, tool output, and permission requests.
- **Claude Code** — Start or continue Claude Code sessions in the same project interface.

Conversations start in **Read only** mode. Select **Allow project edits** to permit file changes. Each agent keeps its own conversation history and settings.

Agents can run on your computer or a remote Linux or macOS host through SSH. Open a project task to connect it to a conversation.

Learn more about [conversations](docs/user-guide.md#the-workflow) and [remote hosts](docs/user-guide.md#remote-projects-over-ssh).

### Documentation

Read the [user guide](docs/user-guide.md) for project setup, GitHub boards, documents, browser tools, storage, and troubleshooting.

See the [architecture guide](docs/architecture.md) for module boundaries and extension points. The user guide also describes [development commands](docs/user-guide.md#development) and [Jenkins releases](docs/user-guide.md#jenkins-ci-and-release-builds).

### Contributing

Read the [contributor guide](AGENTS.md) before you submit a pull request. Open an issue before a large change. Include tests for behavior changes and screenshots for UI changes.

### Building on Kalkidan

Kalkidan uses the [MIT license](LICENSE). Keep its copyright and license notice when you distribute copies or substantial portions of the software.

To add another project tracker, start with the [architecture and extension guide](docs/architecture.md). Adapters provide authentication, project discovery, board data, and supported operations.

---

**Project links** [Issues](https://github.com/verdictan/kalkidan/issues) | [Releases](https://github.com/verdictan/packages/releases?q=kalkidan) | [Homebrew](https://github.com/verdictan/homebrew-tap)
