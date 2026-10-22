import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

export const generation = '33333333-3333-4333-8333-333333333333';
export const runtime = '66666666-6666-4666-8666-666666666666';

/** A fake supervisor process. `reply` answers each stdin request. */
export function fakeSupervisor(reply: (request: any, frame: any) => any[] = () => []) {
  const children: any[] = [];
  const launches: string[][] = [];
  const launch: any = (_: string, args: string[]) => {
    launches.push(args);
    const child: any = new EventEmitter();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const fd3 = new PassThrough();
    child.stdin = stdin;
    child.stdout = stdout;
    child.stderr = new PassThrough();
    child.stdio = [stdin, stdout, child.stderr, fd3];
    child.requests = [] as any[];
    child.frames = [] as any[];
    let sequence = 0;
    child.send = (event: string, data: Record<string, unknown>, extra: Record<string, unknown>) =>
      stdout.write(
        JSON.stringify({
          schema_version: 1,
          correlation_id: 'gateway',
          generation_id: generation,
          sequence: ++sequence,
          event,
          gateway_id: null,
          runtime_generation: null,
          data,
          ...extra,
        }) + '\n',
      );
    child.kill = () => {
      child.killed = true;
      setImmediate(() => child.emit('close'));
    };
    // A closed stdin stops the process, as the real supervisor does.
    stdin.on('finish', () => setImmediate(() => child.emit('close')));
    fd3.on('data', (bytes: Buffer) => child.frames.push(JSON.parse(bytes.toString())));
    stdin.on('data', (bytes: Buffer) => {
      for (const line of bytes.toString().split('\n').filter(Boolean)) {
        const request = JSON.parse(line);
        child.requests.push(request);
        setImmediate(() => {
          for (const [event, data, extra] of reply(request, child.frames.at(-1)))
            child.send(event, data, { correlation_id: request.correlation_id, ...extra });
        });
      }
    });
    setImmediate(() =>
      child.send(
        'supervisor.ready',
        {
          protocol_version: 1,
          cli_version: '0.6.12',
          capabilities: ['gateway.supervise.multi'],
          max_gateways: 16,
          process_inventory: null,
        },
        { correlation_id: 'supervisor' },
      ),
    );
    children.push(child);
    return child;
  };
  return { launch, children, launches };
}
export const attached = (request: any, address = 'http://127.0.0.1:47011', runtimeId = runtime) => [
  [
    'gateway.attached',
    {
      gateway_id: request.gateway_id,
      agent_id: request.agent_id,
      runtime_id: runtimeId,
      state: 'listening',
      effective_address: address,
      ready: false,
      reason_code: 'desktop.readiness_required',
      expires_at: new Date(Date.now() + 600000).toISOString(),
    },
    { gateway_id: request.gateway_id, runtime_generation: 1 },
  ],
];
