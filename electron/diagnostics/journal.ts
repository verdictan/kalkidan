import { writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  CorrelationRecord,
  LocalMeasurements,
  MeasurementName,
  MeasurementSummary,
} from '../../src/domain/diagnostics';

const correlationLimit = 50;
const sampleLimit = 100;
const names: MeasurementName[] = [
  'setup_completion_ms',
  'first_success_ms',
  'stream_first_output_ms',
  'turn_ms',
  'broker_request_ms',
  'recovery_ms',
];
interface Saved {
  version: 1;
  since: string;
  firstLaunchAt: number;
  setupCompletedAt?: number;
  firstSuccessAt?: number;
  running: boolean;
  sessions: number;
  crashes: number;
  turnsCompleted: number;
  turnsFailed: number;
  samples: Partial<Record<MeasurementName, number[]>>;
}
const connectionLoss =
  /^desktop\.(?:transport_lost|process_failed|request_timeout|protocol_invalid)$/;

/**
 * Local measurement hooks. The values stay on this computer, in one small file. Kalkidan sends
 * no telemetry. A support bundle includes a summary only when the user exports it.
 */
export class DiagnosticsJournal {
  private correlations: CorrelationRecord[] = [];
  private state: Saved;
  private file?: string;
  private saving = Promise.resolve();
  private lostAt?: number;
  constructor(private now = Date.now) {
    this.state = this.fresh();
  }
  private fresh(): Saved {
    const now = this.now();
    return {
      version: 1,
      since: new Date(now).toISOString(),
      firstLaunchAt: now,
      running: false,
      sessions: 0,
      crashes: 0,
      turnsCompleted: 0,
      turnsFailed: 0,
      samples: {},
    };
  }
  /**
   * Reads the saved values and starts a session. A session that did not stop cleanly counts as a
   * crash. A missing or damaged file starts again from zero.
   */
  async open(file: string) {
    await this.saving;
    this.file = file;
    try {
      const saved = JSON.parse(await readFile(file, 'utf8')) as Saved;
      if (saved?.version === 1 && Number.isSafeInteger(saved.sessions)) this.state = saved;
    } catch {
      this.state = this.fresh();
    }
    if (this.state.running) this.state.crashes++;
    this.state.running = true;
    this.state.sessions++;
    await this.save();
  }
  /**
   * Marks a clean stop, so the next start does not count a crash. It writes at once, because
   * the process stops after the quit event.
   */
  close() {
    this.state.running = false;
    if (!this.file) return;
    try {
      writeFileSync(this.file, JSON.stringify(this.state) + '\n', { mode: 0o600 });
    } catch {
      // The next start then counts one crash too many. That is safe.
    }
  }
  crash() {
    this.state.crashes++;
    void this.save();
  }
  sample(name: MeasurementName, value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    const list = (this.state.samples[name] ??= []);
    list.push(Math.round(value));
    if (list.length > sampleLimit) list.splice(0, list.length - sampleLimit);
    void this.save();
  }
  correlation(record: CorrelationRecord) {
    this.correlations.unshift(record);
    if (this.correlations.length > correlationLimit) this.correlations.length = correlationLimit;
  }
  /** One broker request ended. Its duration is a sample, and its ID a correlation record. */
  brokerRequest(id: string, operation: string, outcome: string, durationMs: number) {
    this.correlation({
      kind: 'broker',
      id,
      operation,
      outcome,
      at: new Date(this.now()).toISOString(),
      durationMs: Math.round(durationMs),
    });
    this.sample('broker_request_ms', durationMs);
  }
  /** The broker connection closed. A loss starts the recovery time. */
  connectionClosed(code: string) {
    if (connectionLoss.test(code) && this.lostAt === undefined) this.lostAt = this.now();
  }
  /** The account is ready again. Ends the recovery time after a loss. */
  connected() {
    if (this.lostAt === undefined) return;
    this.sample('recovery_ms', this.now() - this.lostAt);
    this.lostAt = undefined;
  }
  /** True after the first setup completion. Kalkidan then stops checking for it. */
  get setupDone() {
    return !!this.state.setupCompletedAt;
  }
  /** The account is signed in and the runtime is installed. Kept once per data folder. */
  setupCompleted() {
    if (this.state.setupCompletedAt) return;
    this.state.setupCompletedAt = this.now();
    this.sample('setup_completion_ms', this.state.setupCompletedAt - this.state.firstLaunchAt);
  }
  /** One agent turn ended. The first completed turn gives the time to the first success. */
  turnEnded(status: string, durationMs?: number, requests: string[] = [], runId = '') {
    if (status === 'completed') this.state.turnsCompleted++;
    else if (status === 'failed') this.state.turnsFailed++;
    if (durationMs !== undefined) this.sample('turn_ms', durationMs);
    if (status === 'completed' && !this.state.firstSuccessAt) {
      this.state.firstSuccessAt = this.now();
      this.sample('first_success_ms', this.state.firstSuccessAt - this.state.firstLaunchAt);
    }
    const at = new Date(this.now()).toISOString();
    for (const id of requests.slice(0, 10))
      this.correlation({
        kind: 'request',
        id,
        operation: `turn ${runId}`.trim(),
        outcome: status,
        at,
      });
    void this.save();
  }
  recentCorrelations() {
    return this.correlations.map((record) => ({ ...record }));
  }
  summary(): LocalMeasurements {
    const samples: LocalMeasurements['samples'] = {};
    for (const name of names) {
      const list = this.state.samples[name];
      if (list?.length) samples[name] = summarize(list);
    }
    return {
      telemetry: 'off',
      since: this.state.since,
      sessions: this.state.sessions,
      crashes: this.state.crashes,
      turnsCompleted: this.state.turnsCompleted,
      turnsFailed: this.state.turnsFailed,
      samples,
    };
  }
  private save() {
    const file = this.file;
    if (!file) return this.saving;
    const text = JSON.stringify(this.state) + '\n';
    this.saving = this.saving
      .then(async () => {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(`${file}.tmp`, text, { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      })
      .catch(() => {
        // Measurements are optional. A failed write must not change the app.
      });
    return this.saving;
  }
}

export function summarize(values: number[]): MeasurementSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return { count: values.length, last: values[values.length - 1], p50: at(0.5), p95: at(0.95) };
}

/** The journal of this process. */
export const journal = new DiagnosticsJournal();
