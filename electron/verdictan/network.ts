import { Readable } from 'node:stream';
import tls from 'node:tls';
import type { ClientRequestConstructorOptions, IncomingMessage } from 'electron';

/**
 * The words for a failed release request. Kalkidan never turns off certificate checks. A proxy
 * or a certificate problem stops the request and shows one of these messages.
 */
export const releaseNetworkMessages = {
  certificate:
    'The release server certificate is not trusted. If your organization inspects HTTPS traffic, add its certificate authority to the system trust store. On an SSH host, you can also set NODE_EXTRA_CA_CERTS. Kalkidan does not turn off certificate checks.',
  proxy:
    'The proxy server did not connect Kalkidan to the release server. Check the proxy settings. On an SSH host, set HTTPS_PROXY for the shell that SSH starts.',
  offline:
    'The release server cannot be reached. Check the network connection and the proxy settings, then try again.',
  timeout:
    'The release server did not answer in time. Check the network connection, then try again.',
} as const;

/** The error codes, names, and messages of an error and of its causes. */
function errorText(error: unknown) {
  const parts: string[] = [];
  let value = error as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
  for (let depth = 0; depth < 4 && value && typeof value === 'object'; depth++) {
    for (const part of [value.code, value.name, value.message])
      if (typeof part === 'string') parts.push(part);
    value = value.cause as typeof value;
  }
  return parts.join(' ');
}

/**
 * Translate a network failure of a release request into plain words. Other errors, for example a
 * cancel, a checksum failure, or a signature failure, return undefined.
 */
export function releaseNetworkError(error: unknown, proxied = false): Error | undefined {
  if (
    error instanceof Error &&
    Object.values(releaseNetworkMessages).includes(error.message as never)
  )
    return error;
  const text = errorText(error);
  if (
    /CERT|SELF_SIGNED|UNABLE_TO_(?:GET|VERIFY)|DEPTH_ZERO|ERR_SSL|SSL_PROTOCOL|ERR_TLS|HANDSHAKE/i.test(
      text,
    )
  )
    return new Error(releaseNetworkMessages.certificate);
  if (/PROXY|TUNNEL/i.test(text)) return new Error(releaseNetworkMessages.proxy);
  if (/TimeoutError|ETIMEDOUT|TIMED_OUT|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT/i.test(text))
    return new Error(releaseNetworkMessages.timeout);
  if (
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ECONNABORTED|ENETUNREACH|ENETDOWN|EHOSTUNREACH|EPIPE|UND_ERR_SOCKET|UND_ERR_CLOSED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NETWORK_IO_SUSPENDED|ERR_CONNECTION_|ERR_ADDRESS_UNREACHABLE|ERR_EMPTY_RESPONSE|fetch failed/i.test(
      text,
    )
  )
    // Node.js reports a failed proxy connection like any failed connection.
    return new Error(proxied ? releaseNetworkMessages.proxy : releaseNetworkMessages.offline);
  return undefined;
}

/** True when the environment sets a proxy for HTTPS requests. Node.js fetch then uses it. */
export function proxyConfigured(env: NodeJS.ProcessEnv = process.env) {
  return !!(env.HTTPS_PROXY || env.https_proxy) && env.NODE_USE_ENV_PROXY === '1';
}

/** True when the error is a network failure that a copy from the desktop can avoid. */
export function isReleaseNetworkError(message: string | undefined) {
  return (
    !!message &&
    [
      releaseNetworkMessages.offline,
      releaseNetworkMessages.proxy,
      releaseNetworkMessages.certificate,
      releaseNetworkMessages.timeout,
    ].includes(message as never)
  );
}

/**
 * A fetch whose network failures have plain words. The response stays unchanged. With `proxied`,
 * a failed connection is a proxy failure.
 */
export function withReleaseErrors(request: typeof fetch, proxied = false): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    try {
      return await request(input, init);
    } catch (error) {
      throw releaseNetworkError(error, proxied) ?? error;
    }
  }) as typeof fetch;
}

/**
 * Add the certificate authorities of the operating system to the trusted set of this Node.js
 * process. The set keeps the bundled authorities and NODE_EXTRA_CA_CERTS. Older Node.js versions
 * cannot do this and keep their current set. Returns true when the system authorities are added.
 */
export function trustSystemCertificates(
  api: Pick<typeof tls, 'getCACertificates' | 'setDefaultCACertificates'> = tls,
) {
  if (
    typeof api.getCACertificates !== 'function' ||
    typeof api.setDefaultCACertificates !== 'function'
  )
    return false;
  try {
    const certificates = new Set([
      ...api.getCACertificates('default'),
      ...api.getCACertificates('system'),
    ]);
    api.setDefaultCACertificates([...certificates]);
    return true;
  } catch {
    return false;
  }
}

/** The part of Electron `net` that the release requests use. */
export interface ChromiumNet {
  request(options: ClientRequestConstructorOptions): {
    setHeader(name: string, value: string): void;
    on(event: 'response', listener: (response: IncomingMessage) => void): unknown;
    on(
      event: 'redirect',
      listener: (
        statusCode: number,
        method: string,
        redirectUrl: string,
        headers: Record<string, string[]>,
      ) => void,
    ): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
    abort(): void;
    end(): void;
  };
}

/**
 * A fetch on the Chromium network stack of Electron. It uses the proxy settings of the system,
 * including PAC files, and the certificate store of the system. Unlike `net.fetch`, it returns a
 * redirect with `redirect: 'manual'`, so that the caller can check each redirect.
 */
export function chromiumFetch(net: ChromiumNet): typeof fetch {
  return ((input: string | URL, init: RequestInit = {}) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal;
      if (signal?.aborted) return reject(signal.reason);
      if (init.method && init.method !== 'GET')
        return reject(new Error('Release requests use only GET.'));
      const request = net.request({
        url: String(input),
        method: 'GET',
        redirect: init.redirect === 'follow' ? 'follow' : 'manual',
        useSessionCookies: false,
        credentials: 'omit',
        cache: 'no-store',
      });
      let settled = false;
      const abort = () => {
        request.abort();
        if (!settled) {
          settled = true;
          reject(signal?.reason);
        }
      };
      signal?.addEventListener('abort', abort, { once: true });
      for (const [name, value] of new Headers(init.headers)) {
        try {
          request.setHeader(name, value);
        } catch {
          // Chromium sets some headers itself, for example Accept-Encoding.
        }
      }
      request.on('redirect', (status, _method, location) => {
        request.abort();
        signal?.removeEventListener('abort', abort);
        if (settled) return;
        settled = true;
        if (init.redirect === 'error') return reject(new Error('Unexpected redirect.'));
        resolve(new Response(null, { status, headers: { location } }));
      });
      request.on('response', (response) => {
        if (settled) return;
        settled = true;
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers))
          for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
        response.on('end', () => signal?.removeEventListener('abort', abort));
        if ([204, 304].includes(response.statusCode))
          return resolve(new Response(null, { status: response.statusCode, headers }));
        const reader = (
          Readable.toWeb(response as unknown as Readable) as ReadableStream<Uint8Array>
        ).getReader();
        // A canceled body stops the request, so no socket stays open.
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const { done, value } = await reader.read();
            if (done) controller.close();
            else controller.enqueue(value);
          },
          cancel(reason) {
            request.abort();
            return reader.cancel(reason);
          },
        });
        resolve(new Response(body, { status: response.statusCode, headers }));
      });
      request.on('error', (error) => {
        signal?.removeEventListener('abort', abort);
        if (settled) return;
        settled = true;
        reject(releaseNetworkError(error) ?? error);
      });
      request.end();
    })) as typeof fetch;
}
