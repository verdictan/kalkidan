import { DesktopProtocolError } from './protocol';

export interface RuntimeCredentials {
  schema_version: 1;
  correlation_id: string;
  runtime_id: string;
  runtime_registration_id: string;
  session_id: string;
  gateway_id: string;
  agent_id: string;
  api_url: string;
  expires_at: string;
  runtime_credential: string;
  inference_credential: string;
  generation: number;
}
export const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** This value stays in the main process. Never serialize it to IPC, logs, or disk. */
export function parseRuntimeCredentials(value: unknown, now = Date.now()): RuntimeCredentials {
  const v = value as RuntimeCredentials;
  const keys = [
    'schema_version',
    'correlation_id',
    'runtime_id',
    'runtime_registration_id',
    'session_id',
    'gateway_id',
    'agent_id',
    'api_url',
    'expires_at',
    'runtime_credential',
    'inference_credential',
    'generation',
  ];
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((key) => !keys.includes(key)) ||
    v.schema_version !== 1 ||
    ![v.runtime_id, v.runtime_registration_id, v.session_id, v.agent_id].every(uuid) ||
    typeof v.correlation_id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(v.correlation_id) ||
    typeof v.gateway_id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(v.gateway_id) ||
    !Number.isSafeInteger(v.generation) ||
    v.generation < 1 ||
    ![v.runtime_credential, v.inference_credential].every(
      (x) => typeof x === 'string' && /^vdt_[A-Za-z0-9_-]{16,512}$/.test(x),
    ) ||
    typeof v.api_url !== 'string' ||
    typeof v.expires_at !== 'string'
  )
    throw new DesktopProtocolError('desktop.invalid_runtime_credential');
  let origin: URL;
  try {
    origin = new URL(v.api_url);
  } catch {
    throw new DesktopProtocolError('desktop.invalid_runtime_credential');
  }
  if (origin.protocol !== 'https:' || origin.origin !== v.api_url)
    throw new DesktopProtocolError('desktop.invalid_runtime_credential');
  const remaining = Date.parse(v.expires_at) - now;
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 900000)
    throw new DesktopProtocolError('desktop.runtime_expired');
  return v;
}
