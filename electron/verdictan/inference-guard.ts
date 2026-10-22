import {
  createServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type OutgoingHttpHeaders,
} from 'node:http';
import type { Socket } from 'node:net';
import { DesktopProtocolError } from './protocol';
import type { ProviderAccessMode } from '../../src/domain/verdictan';
import { parsePolicyResult, type PolicyResult } from '../../src/domain/policy-result';

/** Native routes that each access mode may send. Every other route returns 404. */
export function allowedInference(
  mode: ProviderAccessMode,
  method: string | undefined,
  url: string | undefined,
) {
  const [path, query] = (url || '').split(/\?(.*)/s);
  if (mode === 'codex_subscription')
    return (
      (method === 'POST' &&
        ['/backend-api/codex/responses', '/backend-api/codex/responses/compact'].includes(path)) ||
      (method === 'GET' && path === '/backend-api/codex/models')
    );
  // Only Messages is qualified for Claude subscription. Token counting and discovery are not.
  if (mode === 'claude_subscription')
    return method === 'POST' && path === '/v1/messages' && [undefined, 'beta=true'].includes(query);
  return method === 'POST' && ['/v1/responses', '/v1/messages'].includes(path);
}

/** A turn cannot retry a failed or uncertain inference through native fallback logic. */
export async function inferenceGuard(
  address: string,
  access: boolean | ProviderAccessMode = false,
  /** Receives the policy result of the first refused or escalated response. */
  onPolicy?: (result: PolicyResult) => void,
) {
  // `true` is the original Codex subscription flag.
  const mode: ProviderAccessMode =
    access === true ? 'codex_subscription' : access === false ? 'byok' : access;
  const upstream = new URL(address);
  if (
    upstream.protocol !== 'http:' ||
    upstream.hostname !== '127.0.0.1' ||
    !upstream.port ||
    upstream.username ||
    upstream.password
  )
    throw new DesktopProtocolError('desktop.loopback_required');
  let blocked = false,
    closing = false,
    // The reason for the first refusal in this turn. Later requests repeat it, so the user sees
    // why the turn stopped and not only that it stopped.
    refusal = '';
  let policyReported = false;
  /**
   * Reads a refused body for the reason, and a policy decision for the policy result. The pipe to
   * the agent continues: this only reads a bounded copy of the bytes.
   */
  const recordRefusal = (response: IncomingMessage, refused: boolean) => {
    let text = '';
    const limit = refused ? 4096 : 65536;
    response.on('data', (chunk: Buffer) => {
      if (text.length < limit) text += chunk.toString('utf8');
    });
    response.on('end', () => {
      if (refused) refusal ||= refusalReason(text);
      const policy = parsePolicyResult({ headers: response.headers, body: text });
      if (policy && !policyReported) {
        policyReported = true;
        onPolicy?.(policy);
      }
    });
  };
  const pending = new Set<ClientRequest>(),
    sockets = new Set<Socket>();
  const server = createServer((incoming, outgoing) => {
    if (closing || blocked) {
      outgoing.writeHead(409);
      outgoing.end(
        JSON.stringify({
          error: {
            message: refusal
              ? `This turn stopped after an earlier refusal: ${refusal}`
              : 'This turn requires a new evaluation.',
            type: 'invalid_request_error',
          },
        }),
      );
      return;
    }
    if (!allowedInference(mode, incoming.method, incoming.url) || incoming.headers.upgrade) {
      outgoing.writeHead(404);
      outgoing.end();
      return;
    }
    if (pending.size >= 8) {
      outgoing.writeHead(429);
      outgoing.end();
      return;
    }
    const headers: OutgoingHttpHeaders = { ...incoming.headers, host: upstream.host };
    for (const key of [
      'connection',
      'proxy-authorization',
      'proxy-connection',
      'upgrade',
      'keep-alive',
      'transfer-encoding',
    ])
      delete headers[key];
    const request = httpRequest(
      new URL(incoming.url!, upstream),
      { method: incoming.method, headers },
      (response) => {
        const refused = (response.statusCode || 502) >= 400;
        if (refused) blocked = true;
        // An escalation is HTTP 200 with an empty answer. Its headers name the decision.
        const decision = response.headers['x-verdictan-verdict'];
        if ((refused && !refusal) || decision === 'BLOCK' || decision === 'ESCALATE')
          recordRefusal(response, refused && !refusal);
        outgoing.writeHead(response.statusCode || 502, response.headers);
        response.on('aborted', () => {
          blocked = true;
          outgoing.destroy();
        });
        response.on('error', () => {
          blocked = true;
          outgoing.destroy();
        });
        response.pipe(outgoing);
      },
    );
    pending.add(request);
    request.on('close', () => pending.delete(request));
    request.setTimeout(60000, () => {
      blocked = true;
      request.destroy();
    });
    request.on('error', () => {
      blocked = true;
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    outgoing.on('close', () => {
      if (!outgoing.writableFinished) {
        blocked = true;
        request.destroy();
      }
    });
    let bytes = 0;
    incoming.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) {
        blocked = true;
        request.destroy();
        incoming.destroy();
      }
    });
    incoming.on('aborted', () => {
      blocked = true;
      request.destroy();
    });
    incoming.pipe(request);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('connect', (_request, socket) => socket.destroy());
  server.on('upgrade', (_request, socket) => socket.destroy());
  server.headersTimeout = 10000;
  server.requestTimeout = 120000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let closeTask: Promise<void> | undefined;
  return {
    address: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () =>
      (closeTask ??= new Promise<void>((resolve) => {
        closing = true;
        for (const request of pending) request.destroy();
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      })),
  };
}

/** The error message and code of a refused response, as short plain text. */
export function refusalReason(body: string) {
  let error: { message?: unknown; code?: unknown } | undefined;
  try {
    error = JSON.parse(body)?.error;
  } catch {
    return '';
  }
  const clean = (value: unknown) =>
    typeof value === 'string' ? value.replace(/[^\x20-\x7e]/g, ' ').trim() : '';
  const message = clean(error?.message).slice(0, 300);
  const code = clean(error?.code).slice(0, 80);
  return message && code ? `${message} (${code})` : message || code;
}

export function guardedRoute<T extends { args: string[]; env: NodeJS.ProcessEnv }>(
  route: T,
  from: string,
  to: string,
): T {
  return {
    ...route,
    args: route.args.map((arg) => arg.replaceAll(from, to)),
    env: {
      ...route.env,
      ...(route.env.ANTHROPIC_BASE_URL === from ? { ANTHROPIC_BASE_URL: to } : {}),
    },
  };
}
