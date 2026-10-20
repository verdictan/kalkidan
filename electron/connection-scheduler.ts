export interface RetryState {
  status: 'queued' | 'connecting' | 'connected' | 'retry-wait' | 'error';
  attempt: number;
  retryAt?: number;
  error?: string;
}
export interface SchedulerClock {
  now(): number;
  random(): number;
  later(fn: () => void, ms: number): () => void;
}
const clock: SchedulerClock = {
  now: Date.now,
  random: Math.random,
  later(fn, ms) {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};
interface Attempt {
  state: RetryState;
  pending?: Promise<void>;
  cancel?: () => void;
  generation: number;
}
/** One bounded queue for startup, manual connections, and retries. Never replays RPCs. */
export class ConnectionScheduler {
  private entries = new Map<string, Attempt>();
  private queue: { id: string; entry: Attempt; generation: number }[] = [];
  private active = 0;
  private closed = false;
  constructor(
    private connect: (id: string) => Promise<unknown>,
    private changed: (id: string, state: RetryState) => void,
    private time = clock,
    private limit = 3,
  ) {}
  start(id: string) {
    if (this.closed) return;
    const current = this.entries.get(id);
    if (current && ['queued', 'connecting', 'connected'].includes(current.state.status)) return;
    current?.cancel?.();
    const entry: Attempt = { state: { status: 'queued', attempt: 0 }, generation: 0 };
    this.entries.set(id, entry);
    this.enqueue(id, entry);
  }
  private publish(id: string, entry: Attempt, state: RetryState) {
    entry.state = state;
    this.changed(id, { ...state });
  }
  private enqueue(id: string, entry: Attempt) {
    this.publish(id, entry, { status: 'queued', attempt: entry.state.attempt });
    this.queue.push({ id, entry, generation: entry.generation });
    this.pump();
  }
  private pump() {
    while (!this.closed && this.active < this.limit && this.queue.length) {
      const { id, entry, generation } = this.queue.shift()!;
      if (this.entries.get(id) !== entry || generation !== entry.generation) continue;
      this.active++;
      this.publish(id, entry, { status: 'connecting', attempt: entry.state.attempt + 1 });
      entry.pending = Promise.resolve()
        .then(() => {
          if (this.entries.get(id) !== entry || generation !== entry.generation) return;
          return this.connect(id);
        })
        .then(
          () => {
            if (
              this.entries.get(id) !== entry ||
              generation !== entry.generation ||
              entry.state.status !== 'connecting'
            )
              return;
            this.publish(id, entry, { status: 'connected', attempt: entry.state.attempt });
            entry.cancel = this.time.later(() => {
              if (this.entries.get(id) === entry && entry.state.status === 'connected')
                this.publish(id, entry, { status: 'connected', attempt: 0 });
            }, 60000);
          },
          (error) => {
            if (this.entries.get(id) === entry && generation === entry.generation)
              this.failed(id, String(error?.message || error));
          },
        )
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
  failed(id: string, message: string) {
    const entry = this.entries.get(id);
    if (
      !entry ||
      this.closed ||
      entry.state.status === 'retry-wait' ||
      entry.state.status === 'error'
    )
      return;
    entry.cancel?.();
    const terminal =
      /permission denied|host key|identification has changed|version mismatch|install .*first|command not found|cannot find module/i.test(
        message,
      );
    if (terminal || entry.state.attempt >= 8) {
      this.publish(id, entry, { status: 'error', attempt: entry.state.attempt, error: message });
      return;
    }
    const delay =
      Math.min(30000, 1000 * 2 ** Math.max(0, entry.state.attempt - 1)) *
      (0.8 + this.time.random() * 0.2);
    this.publish(id, entry, {
      status: 'retry-wait',
      attempt: entry.state.attempt,
      error: message,
      retryAt: this.time.now() + delay,
    });
    entry.cancel = this.time.later(() => {
      if (this.entries.get(id) !== entry || this.closed) return;
      entry.generation++;
      this.enqueue(id, entry);
    }, delay);
  }
  stop(id: string) {
    this.entries.get(id)?.cancel?.();
    this.entries.delete(id);
    this.queue = this.queue.filter((task) => task.id !== id);
  }
  close() {
    this.closed = true;
    for (const id of this.entries.keys()) this.stop(id);
  }
}
