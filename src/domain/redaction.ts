/**
 * Redaction for the support bundle. Each credential, token, key, password, cookie, and private
 * key becomes `[redacted]`. E-mail addresses become `[email]`, and the home folder becomes `~`.
 * The result is safe to show in the preview and to export. Identifiers, versions, digests, and
 * error codes stay, because support needs them.
 */
export const redacted = '[redacted]';

// Keys whose value is a secret. A number or a boolean under such a key stays (`max_tokens: 10`).
const secretKey =
  /(?:^|[_.-])(?:token|tokens|secret|secrets|password|passwd|passphrase|credential|credentials|cookie|cookies|authorization|auth|bearer|apikey|api_key|private_key|privatekey|access_key|accesskey|client_secret|refresh|session_key|signature|sig|otp|pin)(?:$|[_.-])|^(?:accessToken|refreshToken|idToken|apiKey|apiToken|clientSecret|privateKey|sessionToken|authToken)$/i;
// Query parameters and `key=value` pairs whose value is a secret.
const secretParameter =
  /\b((?:access_|refresh_|id_|api_|auth_|session_)?(?:token|key|secret|password|passwd|code|signature|sig|credential|apikey))=([^&\s"'#]+)/gi;
const patterns: [RegExp, string][] = [
  // PEM private keys, also when the line breaks are escaped.
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    redacted,
  ],
  // An Authorization header value.
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${redacted}`],
  // JSON Web Tokens.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, redacted],
  // Provider and service key formats.
  [/\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g, redacted],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, redacted],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, redacted],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, redacted],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, redacted],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, redacted],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, redacted],
  [/\b(?:vdt|vtn|verdictan)_[A-Za-z0-9_-]{16,}/gi, redacted],
  // User names and passwords in URLs: https://user:pass@host.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, `$1${redacted}@`],
  // E-mail addresses.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]'],
];

export interface RedactionResult<T> {
  value: T;
  /** The number of values that changed. */
  count: number;
}

/** Redacts one text. `home` is the home folder of the user, when known. */
export function redactText(text: string, home?: string): RedactionResult<string> {
  let count = 0;
  let value = text;
  for (const [pattern, replacement] of patterns)
    value = value.replace(pattern, (...match) => {
      count++;
      return replacement.replace('$1', String(match[1] ?? ''));
    });
  value = value.replace(secretParameter, (_match, key: string) => {
    count++;
    return `${key}=${redacted}`;
  });
  if (home && home.length > 1) {
    const parts = value.split(home);
    if (parts.length > 1) {
      count += parts.length - 1;
      value = parts.join('~');
    }
  }
  return { value, count };
}

/** Redacts each string and each secret key in a JSON value. The input does not change. */
export function redactValue<T>(input: T, home?: string): RedactionResult<T> {
  let count = 0;
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > 32) {
      count++;
      return redacted;
    }
    if (typeof value === 'string') {
      const result = redactText(value, home);
      count += result.count;
      return result.value;
    }
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (
          secretKey.test(key) &&
          child !== null &&
          typeof child !== 'number' &&
          typeof child !== 'boolean'
        ) {
          count++;
          return [key, redacted];
        }
        return [key, visit(child, depth + 1)];
      }),
    );
  };
  return { value: visit(input, 0) as T, count };
}
