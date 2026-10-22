import { shellQuote } from './core';

// SSH starts a non-interactive shell, which often omits package-manager paths.
// Run discovery in sh so unmatched version-manager globs also work with zsh hosts.
// NODE_USE_ENV_PROXY makes fetch use HTTPS_PROXY, HTTP_PROXY, and NO_PROXY from the host
// environment. Node.js 22.23 and 24.21 read it. Older versions ignore it.
export function remoteNodeCommand(argumentsScript: string) {
  const script = `
NODE_USE_ENV_PROXY=1
export NODE_USE_ENV_PROXY
PATH="$PATH:$HOME/.local/bin:$HOME/.volta/bin:$HOME/.local/share/mise/shims:/opt/homebrew/bin:/opt/homebrew/opt/node@22/bin:/usr/local/bin:/home/linuxbrew/.linuxbrew/bin:$HOME/.linuxbrew/bin"
export PATH
for kalkidan_node in "$(command -v node)" "$HOME/.local/bin/node" "$HOME/.volta/bin/node" /opt/homebrew/bin/node /opt/homebrew/opt/node@22/bin/node /usr/local/bin/node /home/linuxbrew/.linuxbrew/bin/node "$HOME/.linuxbrew/bin/node" "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node "$HOME"/.local/share/mise/installs/node/*/bin/node; do
  [ -x "$kalkidan_node" ] || continue
  if "$kalkidan_node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' </dev/null >/dev/null 2>&1; then
    PATH="\${kalkidan_node%/*}:$PATH"
    export PATH
    exec "$kalkidan_node" ${argumentsScript}
  fi
done
echo 'Node.js 22 or later was not found in PATH or common Node installation locations.' >&2
exit 127
`;
  return '/bin/sh -c ' + shellQuote(script);
}
