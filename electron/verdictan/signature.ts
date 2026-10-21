import { createHash, createPublicKey, createVerify, verify, type KeyObject } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * The Verdictan release signing key (ECDSA P-256). Kalkidan trusts each release that this key
 * signs. The source of truth is `cli/ci/release/cosign.pub` in the Verdictan repository.
 */
const releaseKeyPEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEeO9KTH5snl2VBmUmk8jfap6ZvQHn
YzhRK9Hl92raaQIvvrQx8lPDRYGhW0gr3odC3oP/4kRodtfnuTqPNt4yvA==
-----END PUBLIC KEY-----
`;
let releaseKey: KeyObject | undefined;
/** The key object is made on first use, not when the module loads. */
export function releasePublicKey() {
  releaseKey ??= createPublicKey(releaseKeyPEM);
  return releaseKey;
}

/** The base64 SHA-256 digest of the DER public key. Sigstore bundles name the key with it. */
export function keyHint(key: KeyObject) {
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ec')
    throw new Error('Invalid release signing key.');
  return createHash('sha256')
    .update(key.export({ type: 'spki', format: 'der' }))
    .digest('base64');
}

export interface ReleaseSignature {
  /** The base64 SHA-256 digest of the signed file. */
  digest: string;
  /** The DER ECDSA signature. */
  signature: Buffer;
}

const base64 = (value: unknown, bytes?: number) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 1024)
    return undefined;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) return undefined;
  if (bytes !== undefined && decoded.length !== bytes) return undefined;
  return decoded;
};

/**
 * Read a Sigstore bundle (v0.3) that holds a message signature. Only the signature and the
 * digest are used. The key comes from Kalkidan, not from the bundle.
 */
export function parseReleaseSignature(bytes: Buffer, key: KeyObject): ReleaseSignature {
  let bundle: any;
  try {
    if (bytes.length > 65536) throw new Error('too large');
    bundle = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Release signature is not valid.');
  }
  const digest = base64(bundle?.messageSignature?.messageDigest?.digest, 32);
  const signature = base64(bundle?.messageSignature?.signature);
  if (
    bundle?.mediaType !== 'application/vnd.dev.sigstore.bundle.v0.3+json' ||
    bundle.messageSignature?.messageDigest?.algorithm !== 'SHA2_256' ||
    !digest ||
    !signature ||
    signature.length > 256
  )
    throw new Error('Release signature is not valid.');
  if (bundle.verificationMaterial?.publicKey?.hint !== keyHint(key))
    throw new Error('Release signature uses a key that Kalkidan does not trust.');
  return { digest: digest.toString('base64'), signature };
}

/** Verify a small file in memory, for example a release manifest. */
export function verifySignedBytes(bytes: Buffer, signature: ReleaseSignature, key: KeyObject) {
  if (createHash('sha256').update(bytes).digest('base64') !== signature.digest)
    throw new Error('Release signature does not match the file.');
  if (!verify('sha256', bytes, key, signature.signature))
    throw new Error('Release signature verification failed.');
}

/** Verify a large file, for example a runtime archive, without reading all of it into memory. */
export async function verifySignedFile(path: string, signature: ReleaseSignature, key: KeyObject) {
  const hash = createHash('sha256');
  const verifier = createVerify('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    verifier.update(chunk);
  }
  if (hash.digest('base64') !== signature.digest)
    throw new Error('Release signature does not match the file.');
  if (!verifier.verify(key, signature.signature))
    throw new Error('Release signature verification failed.');
}
