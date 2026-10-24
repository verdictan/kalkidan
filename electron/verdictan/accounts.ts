import { randomUUID } from 'node:crypto';
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { SavedVerdictanAccount, VerdictanAccount } from '../../src/domain/verdictan';
import { writeJSON } from '../storage/atomic-json';
import { isVerdictanRegion, type VerdictanRegion } from './region';

interface AccountsFile {
  version: 1;
  activeId: string;
  accounts: SavedVerdictanAccount[];
}
const validId = (id: unknown): id is string =>
  typeof id === 'string' &&
  /^(legacy-(eu|us)|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(id);

/** Parses a saved account list. Returns undefined for a damaged list. */
function valid(text: string): AccountsFile | undefined {
  try {
    const data = JSON.parse(text) as AccountsFile;
    if (
      data?.version !== 1 ||
      !Array.isArray(data.accounts) ||
      !data.accounts.length ||
      !data.accounts.every(
        (a) => a && validId(a.id) && (!a.region || isVerdictanRegion(a.region)),
      ) ||
      new Set(data.accounts.map((a) => a.id)).size !== data.accounts.length ||
      !data.accounts.some((a) => a.id === data.activeId)
    )
      return undefined;
    return data;
  } catch {
    return undefined;
  }
}

/** The index holds labels only. The runtime keeps each profile's credentials in secure storage. */
export class VerdictanAccounts {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(
    private file: string,
    private data: AccountsFile,
  ) {}

  static async open(root: string, region?: VerdictanRegion) {
    const file = join(root, 'verdictan-accounts.json');
    let text: string | undefined;
    try {
      text = await readFile(file, 'utf8');
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (text !== undefined) {
      const data = valid(text);
      if (data) return new VerdictanAccounts(file, data);
      // A damaged list must not stop the app. Keep a copy, then start a new list. The sign-ins
      // stay in the secure profiles of the runtime.
      await rename(file, `${file}.damaged`).catch(() => {});
    }
    const initial: SavedVerdictanAccount = {
      id: region ? `legacy-${region}` : randomUUID(),
      region,
    };
    const data: AccountsFile = { version: 1, activeId: initial.id, accounts: [initial] };
    await writeJSON(file, data);
    return new VerdictanAccounts(file, data);
  }
  snapshot() {
    return structuredClone(this.data);
  }
  active() {
    return structuredClone(this.data.accounts.find((a) => a.id === this.data.activeId)!);
  }
  get(id: unknown) {
    const account = this.data.accounts.find((a) => a.id === id);
    if (!account) throw new Error('Saved Verdictan account not found.');
    return structuredClone(account);
  }
  private update(change: (data: AccountsFile) => void) {
    const task = this.queue.then(async () => {
      const next = structuredClone(this.data);
      change(next);
      await writeJSON(this.file, next);
      this.data = next;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async add() {
    const account: SavedVerdictanAccount = { id: randomUUID() };
    await this.update((data) => {
      data.accounts.push(account);
    });
    return account;
  }
  async select(id: string) {
    this.get(id);
    await this.update((data) => {
      data.activeId = id;
    });
  }
  /**
   * Removes an account from the list. The last account stays, so one account is always
   * active. A removed active account makes the first other account active.
   */
  async remove(id: string) {
    this.get(id);
    if (this.data.accounts.length === 1) return;
    await this.update((data) => {
      data.accounts = data.accounts.filter((a) => a.id !== id);
      if (data.activeId === id) data.activeId = data.accounts[0].id;
    });
  }
  /** Removes the labels of a signed-out account. */
  async forget(id: string) {
    const previous = this.get(id);
    if (!previous.userName && !previous.userEmail && !previous.organizationName) return;
    await this.update((data) => {
      const account = data.accounts.find((a) => a.id === id)!;
      delete account.userName;
      delete account.userEmail;
      delete account.organizationName;
    });
  }
  async setRegion(region: VerdictanRegion) {
    if (!isVerdictanRegion(region)) throw new Error('Select the EU or US Verdictan region.');
    await this.update((data) => {
      const active = data.accounts.find((a) => a.id === data.activeId)!;
      if (active.id.startsWith('legacy-')) {
        const id = `legacy-${region}`;
        if (!data.accounts.some((a) => a.id === id)) data.accounts.push({ id, region });
        data.activeId = id;
      } else {
        active.region = region;
        delete active.userName;
        delete active.userEmail;
        delete active.organizationName;
      }
    });
  }
  async remember(id: string, account: VerdictanAccount | undefined) {
    if (account?.state !== 'authenticated') return;
    const labels = {
      userName: account.userName,
      userEmail: account.userEmail,
      organizationName: account.organizationName,
    };
    const previous = this.get(id);
    if (
      Object.entries(labels).every(([key, value]) => previous[key as keyof typeof labels] === value)
    )
      return;
    await this.update((data) => {
      Object.assign(
        data.accounts.find((a) => a.id === id)!,
        labels,
      );
    });
  }
}

export function accountProfile(account: SavedVerdictanAccount) {
  if (!validId(account.id)) throw new Error('Invalid saved account ID.');
  if (!account.region) return undefined;
  if (!isVerdictanRegion(account.region)) throw new Error('Invalid saved account region.');
  if (account.id.startsWith('legacy-')) {
    if (account.id !== `legacy-${account.region}`)
      throw new Error('Invalid legacy account region.');
    return `kalkidan-${account.region}`;
  }
  return `kalkidan-${account.region}-${account.id}`;
}
