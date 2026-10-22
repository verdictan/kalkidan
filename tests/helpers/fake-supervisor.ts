import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

export const generation = '33333333-3333-4333-8333-333333333333';

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
          runtime_id: null,
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
          max_runtimes_per_gateway: 16,
          max_runtimes: 64,
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
/**
 * Answers each request as the real supervisor does (contract revision 3). `addressOf` gives the
 * shared address of a gateway.
 */
export function supervisorReplies(
  addressOf: (gatewayId: string) => string = () => 'http://127.0.0.1:47011',
) {
  const gateways = new Map<string, string>();
  return (request: any, frame: any): any[] => {
    const runtimeSummary = () => ({
      gateway_id: request.gateway_id,
      runtime_id: request.runtime_id,
      session_id: frame.session_id,
      state: 'listening',
      effective_address: gateways.get(request.gateway_id),
      ready: false,
      reason_code: 'desktop.readiness_required',
      expires_at: frame.expires_at,
    });
    const envelope = {
      gateway_id: request.gateway_id ?? null,
      runtime_id: request.runtime_id ?? null,
    };
    switch (request.operation) {
      case 'gateway.attach':
        gateways.set(request.gateway_id, addressOf(request.gateway_id));
        return [
          [
            'gateway.attached',
            {
              gateway_id: request.gateway_id,
              agent_id: request.agent_id,
              state: 'listening',
              effective_address: gateways.get(request.gateway_id),
              runtimes: [],
            },
            envelope,
          ],
        ];
      case 'runtime.attach':
        return [
          [
            'runtime.attached',
            runtimeSummary(),
            { ...envelope, runtime_generation: frame.generation },
          ],
        ];
      case 'credential.renew':
        return [
          [
            'credential.renewed',
            runtimeSummary(),
            { ...envelope, runtime_generation: frame.generation },
          ],
        ];
      case 'runtime.detach':
        return [['runtime.stopping', {}, envelope]];
      case 'gateway.detach':
        return [['gateway.stopping', {}, envelope]];
      case 'supervisor.shutdown':
        return [['supervisor.stopping', {}, envelope]];
      default:
        return [];
    }
  };
}
