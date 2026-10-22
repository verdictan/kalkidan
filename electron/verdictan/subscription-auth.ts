import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeJSON } from '../storage/atomic-json';
import { DesktopProtocolError } from './protocol';

/** The native Codex ChatGPT login of this host. Keep it in memory only for a short time. */
export interface CodexSubscriptionLogin {
  accessToken: string;
  accountId: string;
  idToken?: string;
}
/** No ChatGPT login of Codex on this host, or a login with an API key. */
export const codexLoginRequired = 'desktop.codex_subscription_login_required';
/** The login file of Codex on this host is not a file that Kalkidan can read safely. */
export const codexLoginInvalid = 'desktop.codex_subscription_login_invalid';

/** The login file of the native Codex CLI on this host. */
export function codexLoginFile() {
  return join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
}

/**
 * Reads the native Codex ChatGPT login of this host. The refresh token is never read out. On an
 * SSH host this runs on the host, so a login never leaves the machine where it is.
 */
export async function readCodexSubscriptionLogin(
  source = codexLoginFile(),
): Promise<CodexSubscriptionLogin> {
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
    (error: { code?: unknown }) => {
      throw new DesktopProtocolError(
        error?.code === 'ENOENT' ? codexLoginRequired : codexLoginInvalid,
      );
    },
  );
  let value: any;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 65536) throw new DesktopProtocolError(codexLoginInvalid);
    value = JSON.parse(await handle.readFile('utf8'));
  } catch (error) {
    throw error instanceof DesktopProtocolError
      ? error
      : new DesktopProtocolError(codexLoginInvalid);
  } finally {
    await handle.close();
  }
  const tokens = value?.tokens;
  if (
    !tokens ||
    typeof tokens.access_token !== 'string' ||
    !tokens.access_token ||
    typeof tokens.account_id !== 'string' ||
    !tokens.account_id ||
    value.OPENAI_API_KEY
  )
    throw new DesktopProtocolError(codexLoginRequired);
  return {
    accessToken: tokens.access_token,
    accountId: tokens.account_id,
    ...(typeof tokens.id_token === 'string' ? { idToken: tokens.id_token } : {}),
  };
}

/** Writes the login into the managed Codex home. Refresh credentials never enter it or SSH. */
export async function prepareSubscriptionAuth(
  home: string,
  login: CodexSubscriptionLogin | string = codexLoginFile(),
) {
  const value = typeof login === 'string' ? await readCodexSubscriptionLogin(login) : login;
  await writeJSON(join(home, 'auth.json'), {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      access_token: value.accessToken,
      account_id: value.accountId,
      ...(value.idToken ? { id_token: value.idToken } : {}),
    },
  });
}
