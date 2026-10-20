export class GitHubRequestError extends Error {
  constructor(
    public readonly reason:
      | 'rate-limit'
      | 'permission'
      | 'signed-out'
      | 'unavailable'
      | 'unknown-outcome'
      | 'invalid-response',
    public readonly retryAt?: number,
  ) {
    super(
      {
        'rate-limit': 'GitHub is limiting requests. Wait before you retry.',
        permission: 'GitHub denied access. Check project permissions and organization SSO.',
        'signed-out': 'GitHub authentication expired. Sign in again.',
        unavailable: 'GitHub could not complete this request. Try again later.',
        'unknown-outcome':
          'GitHub did not confirm the change. Refresh the project before you retry.',
        'invalid-response': 'GitHub returned an incomplete response. Refresh the project.',
      }[reason],
    );
  }
}

/** Bound concurrent work. Mutations are never replayed after an uncertain response. */
export class GitHubRequestScheduler {
  private active = 0;
  private queue: { start(): void; reject(error: Error): void }[] = [];
  private blockedUntil = 0;
  constructor(
    private limit = 3,
    private capacity = 100,
    private now = Date.now,
  ) {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(capacity) || capacity < 0)
      throw new Error('Invalid GitHub request limits.');
  }
  deferUntil(time: number) {
    if (Number.isFinite(time)) this.blockedUntil = Math.max(this.blockedUntil, time);
    for (const pending of this.queue.splice(0))
      pending.reject(new GitHubRequestError('rate-limit', this.blockedUntil));
  }
  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.blockedUntil > this.now())
      return Promise.reject(new GitHubRequestError('rate-limit', this.blockedUntil));
    if (this.queue.length >= this.capacity && this.active >= this.limit)
      return Promise.reject(new GitHubRequestError('unavailable'));
    return new Promise((resolve, reject) => {
      const start = () => {
        this.active++;
        void Promise.resolve()
          .then(work)
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.queue.shift()?.start();
          });
      };
      if (this.active < this.limit) start();
      else this.queue.push({ start, reject });
    });
  }
}

export function githubResponse(
  stdout: string,
  mutation: boolean,
  scheduler: GitHubRequestScheduler,
  now = Date.now(),
  rest = false,
) {
  // gh --include emits one header block followed by the JSON body.
  const match = stdout.match(/^HTTP\/[\d.]+ (\d{3})[^\r\n]*\r?\n((?:[^\r\n]+\r?\n)*)\r?\n/);
  const status = match ? Number(match[1]) : 200;
  const headers = new Map(
    (match?.[2] || '').split(/\r?\n/).flatMap((line) => {
      const index = line.indexOf(':');
      return index > 0 ? [[line.slice(0, index).toLowerCase(), line.slice(index + 1).trim()]] : [];
    }),
  );
  const retry = headers.get('retry-after');
  const retryAt =
    retry && /^\d+$/.test(retry) ? now + Number(retry) * 1000 : retry ? Date.parse(retry) : NaN;
  const reset = Number(headers.get('x-ratelimit-reset')) * 1000;
  const limited =
    status === 429 ||
    (status === 403 && (retry !== undefined || headers.get('x-ratelimit-remaining') === '0'));
  if (limited || headers.get('x-ratelimit-remaining') === '0')
    scheduler.deferUntil(
      Math.max(now + 1000, Number.isFinite(retryAt) ? retryAt : reset > now ? reset : now + 60000),
    );
  if (limited)
    throw new GitHubRequestError(
      'rate-limit',
      Number.isFinite(retryAt) ? retryAt : reset > now ? reset : now + 60000,
    );
  if (status === 401) throw new GitHubRequestError('signed-out');
  if (status === 403 || status === 404) throw new GitHubRequestError('permission');
  if (status >= 400) throw new GitHubRequestError(mutation ? 'unknown-outcome' : 'unavailable');
  let payload: any;
  try {
    payload = JSON.parse(match ? stdout.slice(match[0].length) : stdout);
  } catch {
    throw new GitHubRequestError(mutation ? 'unknown-outcome' : 'invalid-response');
  }
  if (!payload || typeof payload !== 'object')
    throw new GitHubRequestError(mutation ? 'unknown-outcome' : 'invalid-response');
  if (Array.isArray(payload.errors) && payload.errors.length) {
    if (mutation && payload.data && Object.values(payload.data).some((value) => value !== null))
      throw new GitHubRequestError('unknown-outcome');
    if (payload.errors.some((error: any) => error?.type === 'RATE_LIMITED')) {
      scheduler.deferUntil(now + 60000);
      throw new GitHubRequestError('rate-limit', now + 60000);
    }
    if (payload.errors.some((error: any) => ['FORBIDDEN', 'NOT_FOUND'].includes(error?.type)))
      throw new GitHubRequestError('permission');
    throw new GitHubRequestError(mutation ? 'unknown-outcome' : 'unavailable');
  }
  if (rest) return { body: payload, link: headers.get('link') };
  if (!payload.data || typeof payload.data !== 'object')
    throw new GitHubRequestError(mutation ? 'unknown-outcome' : 'invalid-response');
  if (
    mutation &&
    (!Object.keys(payload.data).length ||
      Object.values(payload.data).some((value) => value === null))
  )
    throw new GitHubRequestError('unknown-outcome');
  return payload.data;
}
