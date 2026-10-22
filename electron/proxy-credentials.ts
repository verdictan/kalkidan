import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { writeJSON } from './storage/atomic-json';

/** A proxy that asks for a user name and password, from the Electron `login` event. */
export interface ProxyChallenge {
  host: string;
  port: number;
  scheme: string;
  realm: string;
}
export interface ProxySignIn {
  username: string;
  password: string;
}
/** A saved proxy sign-in, as Settings shows it. It never has the password. */
export interface SavedProxySignIn {
  proxy: string;
  username: string;
}
/** The Electron `safeStorage` calls. The key is in the macOS Keychain or the OS secret store. */
export interface SecretStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
interface StoredSignIn {
  proxy: string;
  username: string;
  /** The password, encrypted with `safeStorage`, in base64. */
  secret: string;
}

/** The proxy key of a challenge: host and port. The realm can change between challenges. */
export const proxyKey = (challenge: Pick<ProxyChallenge, 'host' | 'port'>) =>
  `${challenge.host.toLowerCase()}:${challenge.port}`;

const validChallenge = (value: ProxyChallenge) =>
  !!value &&
  typeof value.host === 'string' &&
  /^[A-Za-z0-9.[\]:-]{1,253}$/.test(value.host) &&
  Number.isSafeInteger(value.port) &&
  value.port > 0 &&
  value.port < 65536;

/**
 * The saved proxy sign-ins. The password is encrypted with the OS secret store. When the OS has no
 * secret store, for example on Linux without a keyring, Kalkidan does not save the password. The
 * file never has a password in plain text, and nothing logs it.
 */
export class ProxyCredentialStore {
  constructor(
    private file: string,
    private storage: SecretStorage,
    private platform: string = process.platform,
  ) {}
  /** True when the OS can protect a saved password. */
  canSave() {
    try {
      return (
        this.storage.isEncryptionAvailable() &&
        !(this.platform === 'linux' && this.storage.getSelectedStorageBackend?.() === 'basic_text')
      );
    } catch {
      return false;
    }
  }
  private async read(): Promise<StoredSignIn[]> {
    let file;
    try {
      file = await open(this.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    try {
      if ((await file.stat()).size > 65536) return [];
      const rows = JSON.parse(await file.readFile('utf8'));
      return Array.isArray(rows)
        ? rows.filter(
            (row) =>
              row &&
              typeof row.proxy === 'string' &&
              typeof row.username === 'string' &&
              typeof row.secret === 'string',
          )
        : [];
    } catch {
      // A damaged file has no usable sign-in. The next save replaces it.
      return [];
    } finally {
      await file.close();
    }
  }
  private async write(rows: StoredSignIn[]) {
    if (!rows.length) await rm(this.file, { force: true });
    else await writeJSON(this.file, rows);
  }
  async list(): Promise<SavedProxySignIn[]> {
    return (await this.read()).map(({ proxy, username }) => ({ proxy, username }));
  }
  async get(proxy: string): Promise<ProxySignIn | undefined> {
    const row = (await this.read()).find((entry) => entry.proxy === proxy);
    if (!row || !this.canSave()) return undefined;
    try {
      return {
        username: row.username,
        password: this.storage.decryptString(Buffer.from(row.secret, 'base64')),
      };
    } catch {
      return undefined;
    }
  }
  /** Saves a sign-in. Returns false when the OS cannot protect the password. */
  async save(proxy: string, value: ProxySignIn) {
    if (!this.canSave()) return false;
    const secret = this.storage.encryptString(value.password).toString('base64');
    const rows = (await this.read()).filter((entry) => entry.proxy !== proxy);
    rows.push({ proxy, username: value.username, secret });
    await this.write(rows.slice(-20));
    return true;
  }
  async remove(proxy: string) {
    const rows = await this.read();
    const rest = rows.filter((entry) => entry.proxy !== proxy);
    if (rest.length !== rows.length) await this.write(rest);
    return rest.length !== rows.length;
  }
}

/** The answer of the user to a proxy sign-in prompt. Null when the user cancels. */
export type ProxyPromptAnswer = (ProxySignIn & { remember: boolean }) | null;

/**
 * Answers the proxy challenges of the release requests. A saved sign-in comes first. When it
 * fails, or when none is saved, the user gets a prompt. One prompt serves all the requests that
 * wait for the same proxy. TLS verification does not change.
 */
export class ProxyAuthenticator {
  /** Forget a sign-in, for example after the user removed it in Settings. */
  forget(proxy: string) {
    this.session.delete(proxy);
  }
  private pending = new Map<string, Promise<ProxySignIn | null>>();
  /** Sign-ins of this app session that the user did not save. They stay in memory only. */
  private session = new Map<string, ProxySignIn>();
  constructor(
    private store: ProxyCredentialStore,
    private prompt: (challenge: ProxyChallenge, canSave: boolean) => Promise<ProxyPromptAnswer>,
    private changed?: () => void,
  ) {}
  /**
   * `retry` is true when the proxy refused the sign-in that this request sent. A refused saved
   * sign-in is removed, and the user gets a prompt.
   */
  async login(challenge: ProxyChallenge, retry: boolean): Promise<ProxySignIn | null> {
    if (!validChallenge(challenge)) return null;
    const key = proxyKey(challenge);
    if (retry) {
      this.session.delete(key);
      if (await this.store.remove(key)) this.changed?.();
    } else {
      const known = this.session.get(key) ?? (await this.store.get(key));
      if (known) return known;
    }
    let task = this.pending.get(key);
    if (!task) {
      task = (async () => {
        const answer = await this.prompt(challenge, this.store.canSave());
        if (!answer || !answer.username || !answer.password) return null;
        const signIn = { username: answer.username, password: answer.password };
        if (answer.remember && (await this.store.save(key, signIn))) this.changed?.();
        else this.session.set(key, signIn);
        return signIn;
      })();
      this.pending.set(key, task);
      void task.finally(() => this.pending.delete(key)).catch(() => {});
    }
    return task;
  }
}

/** A prompt request for the window. It has no secret. */
export interface ProxyPromptRequest {
  id: string;
  host: string;
  port: number;
  realm: string;
  canSave: boolean;
}

/**
 * The proxy sign-in prompts of the window. `ask` sends a request to the window and waits for its
 * answer. Without an answer in 5 minutes, or without a window, the sign-in is canceled.
 */
export class ProxyPrompts {
  private pending = new Map<string, (answer: ProxyPromptAnswer) => void>();
  constructor(
    /** Sends the request to a window. False when no window is open. */
    private send: (request: ProxyPromptRequest) => boolean,
    private timeoutMs = 5 * 60000,
    private newId: () => string = randomUUID,
  ) {}
  ask(challenge: ProxyChallenge, canSave: boolean): Promise<ProxyPromptAnswer> {
    return new Promise((resolve) => {
      const id = this.newId();
      const timer = setTimeout(() => finish(null), this.timeoutMs);
      timer.unref?.();
      const finish = (answer: ProxyPromptAnswer) => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(answer);
      };
      this.pending.set(id, finish);
      const sent = this.send({
        id,
        host: challenge.host,
        port: challenge.port,
        realm: String(challenge.realm ?? '').slice(0, 200),
        canSave,
      });
      if (!sent) finish(null);
    });
  }
  /** The answer of the window. An unknown ID or a malformed answer changes nothing or cancels. */
  answer(id: unknown, value: any) {
    const finish = typeof id === 'string' ? this.pending.get(id) : undefined;
    if (!finish) return;
    const valid =
      value &&
      typeof value.username === 'string' &&
      typeof value.password === 'string' &&
      value.username.length > 0 &&
      value.username.length <= 256 &&
      value.password.length > 0 &&
      value.password.length <= 1024;
    finish(
      valid
        ? { username: value.username, password: value.password, remember: value.remember === true }
        : null,
    );
  }
}
