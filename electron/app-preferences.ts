import { readFile } from 'node:fs/promises';
import { writeJSON } from './storage/atomic-json';
import type { DataNoticeState } from '../src/domain/data-policy';
import type { FirstRunState, NotificationPreferences } from '../src/domain/verdictan';

interface PreferencesFile {
  schema: 1;
  welcomeDone: boolean;
  everSignedIn: boolean;
  /** True after the user read the data notice once. */
  dataNoticeSeen: boolean;
  notifications: NotificationPreferences;
  /** True when the app asks before it quits while work runs on SSH hosts. */
  sshQuitPrompt: boolean;
}

const defaults = (): PreferencesFile => ({
  schema: 1,
  welcomeDone: false,
  everSignedIn: false,
  dataNoticeSeen: false,
  notifications: { finished: true, needsInput: true },
  sshQuitPrompt: true,
});

/** The kind of a desktop notification. Each kind has its own choice in Settings. */
export type NotificationKind = 'finished' | 'needs-input';

/**
 * Choices of the user that the main process keeps in the data folder: the first-run state and
 * the notification choices. They survive a cleared renderer storage. A damaged file gives the
 * defaults. Writes go in order, so the last choice wins.
 */
export class AppPreferences {
  private value?: PreferencesFile;
  private loading?: Promise<PreferencesFile>;
  private writing: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}
  private async read(): Promise<PreferencesFile> {
    if (this.value) return this.value;
    this.loading ??= (async () => {
      const value = defaults();
      try {
        const raw = JSON.parse(await readFile(this.file, 'utf8'));
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          value.welcomeDone = raw.welcomeDone === true;
          value.everSignedIn = raw.everSignedIn === true;
          value.dataNoticeSeen = raw.dataNoticeSeen === true;
          value.sshQuitPrompt = raw.sshQuitPrompt !== false;
          const notifications = raw.notifications;
          if (notifications && typeof notifications === 'object') {
            value.notifications = {
              finished: notifications.finished !== false,
              needsInput: notifications.needsInput !== false,
            };
          }
        }
      } catch {
        // A missing or damaged file gives the defaults.
      }
      this.value ??= value;
      return this.value;
    })();
    return this.loading;
  }
  private async save(change: (value: PreferencesFile) => void) {
    const value = await this.read();
    change(value);
    const snapshot = structuredClone(value);
    const write = this.writing.then(() => writeJSON(this.file, snapshot));
    this.writing = write.catch(() => undefined);
    await write;
  }
  async firstRun(): Promise<FirstRunState> {
    const { welcomeDone, everSignedIn } = await this.read();
    return { welcomeDone, everSignedIn };
  }
  async setWelcomeDone(): Promise<FirstRunState> {
    if (!(await this.read()).welcomeDone) await this.save((value) => (value.welcomeDone = true));
    return this.firstRun();
  }
  /** Records that an account signed in on this computer. Writes only once. */
  async setSignedIn(): Promise<FirstRunState> {
    if (!(await this.read()).everSignedIn) await this.save((value) => (value.everSignedIn = true));
    return this.firstRun();
  }
  /** True after the user read the data notice once. */
  async dataNotice(): Promise<DataNoticeState> {
    return { seen: (await this.read()).dataNoticeSeen };
  }
  /** Records that the user read the data notice. Writes only once. */
  async setDataNoticeSeen(): Promise<DataNoticeState> {
    if (!(await this.read()).dataNoticeSeen)
      await this.save((value) => (value.dataNoticeSeen = true));
    return this.dataNotice();
  }
  async notifications(): Promise<NotificationPreferences> {
    return { ...(await this.read()).notifications };
  }
  async setNotifications(input: unknown): Promise<NotificationPreferences> {
    if (
      !input ||
      typeof input !== 'object' ||
      typeof (input as NotificationPreferences).finished !== 'boolean' ||
      typeof (input as NotificationPreferences).needsInput !== 'boolean'
    )
      throw new Error('Invalid notification preferences.');
    const { finished, needsInput } = input as NotificationPreferences;
    await this.save((value) => (value.notifications = { finished, needsInput }));
    return this.notifications();
  }
  /** True when the app asks before it quits while work runs on SSH hosts. */
  async sshQuitPrompt() {
    return (await this.read()).sshQuitPrompt;
  }
  /** "Don't ask again" sets false. The switch in Settings sets it again. */
  async setSshQuitPrompt(input: unknown) {
    if (typeof input !== 'boolean') throw new Error('Invalid quit question setting.');
    await this.save((value) => (value.sshQuitPrompt = input));
    return this.sshQuitPrompt();
  }
  /** True when the user wants notifications of this kind. */
  async allows(kind: NotificationKind) {
    const { finished, needsInput } = await this.notifications();
    return kind === 'finished' ? finished : needsInput;
  }
}

/**
 * The kind of a notification. The window sends the kind. An older window sends none: its
 * "… finished" title is a finished notification, and each other title asks for input.
 */
export function notificationKind(input: { title: string; kind?: unknown }): NotificationKind {
  if (input.kind === 'finished' || input.kind === 'needs-input') return input.kind;
  return / finished$/.test(input.title) ? 'finished' : 'needs-input';
}
