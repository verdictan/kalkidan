import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeJSON } from '../storage/atomic-json';

/** Read only this host's native login. Refresh credentials never enter the managed home or SSH. */
export async function prepareSubscriptionAuth(
  home: string,
  source = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'),
) {
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => {
    throw Error('Sign in to Codex on this machine before using subscription access.');
  });
  let value: any;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 65536) throw Error('Invalid native Codex login file.');
    value = JSON.parse(await handle.readFile('utf8'));
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
    throw Error('Sign in to Codex with your subscription on this machine.');
  await writeJSON(join(home, 'auth.json'), {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      access_token: tokens.access_token,
      account_id: tokens.account_id,
      ...(typeof tokens.id_token === 'string' ? { id_token: tokens.id_token } : {}),
    },
  });
}
