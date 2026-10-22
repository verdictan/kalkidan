import { homedir } from 'node:os';
import { redacted, redactText } from '../../src/domain/redaction';
import { journal } from '../diagnostics/journal';

/** The last bytes of stderr that Kalkidan keeps for each gateway or supervisor process. */
const stderrLimit = 4096;
/** The longest reason that one diagnostics record keeps. */
const detailLimit = 1500;

/**
 * The end of the stderr of a gateway or supervisor process. The text is for diagnostics only.
 * `text` redacts each known credential and each value that looks like a secret.
 */
export class StderrTail {
  private value = '';
  push(bytes: Buffer | string) {
    this.value = (this.value + bytes.toString()).slice(-stderrLimit);
  }
  text(secrets: string[] = []) {
    let value = this.value;
    for (const secret of secrets)
      if (secret.length >= 8) value = value.split(secret).join(redacted);
    return redactText(value, homedir()).value.trim();
  }
}

/** Safe readiness fields. Only short codes and fixed words, never text from the gateway. */
const word = /^[a-z_]{1,40}$/;
const code = /^desktop\.[a-z_]{1,100}$/;
/**
 * The reason of a readiness reply that did not pass, for diagnostics. It has the HTTP status,
 * the fixed state words of the reply, and the safe error code. It never has the message text.
 */
export function readinessReason(status: number, reply: unknown) {
  const body = reply && typeof reply === 'object' ? (reply as Record<string, any>) : {};
  const parts = [`http ${status}`];
  if (typeof body.ready === 'boolean') parts.push(`ready ${body.ready}`);
  for (const key of [
    'credential',
    'dependencies',
    'protocol_acceptance',
    'provider_authentication',
  ])
    if (typeof body[key] === 'string' && word.test(body[key])) parts.push(`${key} ${body[key]}`);
  const plane = body.control_plane;
  if (plane && typeof plane === 'object' && typeof plane.ready === 'boolean')
    parts.push(`control_plane ${plane.ready ? 'ready' : 'not ready'}`);
  const error = body.error && typeof body.error === 'object' ? body.error.code : undefined;
  if (typeof error === 'string' && code.test(error)) parts.push(`error ${error}`);
  return parts.join(', ');
}

/**
 * Keeps why a gateway or supervisor step failed: in Settings › Diagnostics, and in the log of
 * the main process. `detail` is redacted again here, and it is never sent anywhere.
 */
export function logGatewayFailure(operation: string, outcome: string, detail = '') {
  const text = redactText(detail, homedir()).value.slice(0, detailLimit).trim();
  journal.gatewayFailure(operation, outcome, text || undefined);
  console.warn(`[verdictan] ${operation} failed: ${outcome}${text ? `\n${text}` : ''}`);
}
