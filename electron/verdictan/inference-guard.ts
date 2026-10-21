import {
  createServer,
  request as httpRequest,
  type ClientRequest,
  type OutgoingHttpHeaders,
} from 'node:http';
import type { Socket } from 'node:net';
import { DesktopProtocolError } from './protocol';

/** A turn cannot retry a failed or uncertain inference through native fallback logic. */
export async function inferenceGuard(address: string, subscription = false) {
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
    closing = false;
  const pending = new Set<ClientRequest>(),
    sockets = new Set<Socket>();
  const server = createServer((incoming, outgoing) => {
    const path = incoming.url?.split('?')[0];
    if (closing || blocked) {
      outgoing.writeHead(409);
      outgoing.end(
        '{"error":{"message":"This turn requires a new evaluation.","type":"invalid_request_error"}}',
      );
      return;
    }
    if (
      !(subscription
        ? (incoming.method === 'POST' &&
            ['/backend-api/codex/responses', '/backend-api/codex/responses/compact'].includes(
              path || '',
            )) ||
          (incoming.method === 'GET' && path === '/backend-api/codex/models')
        : incoming.method === 'POST' && ['/v1/responses', '/v1/messages'].includes(path || '')) ||
      incoming.headers.upgrade
    ) {
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
        if ((response.statusCode || 502) >= 400) blocked = true;
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
