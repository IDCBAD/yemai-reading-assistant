import { WorkosApiError } from './workosTransport';

export const WORKOS_IDENTITY_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw+qviO5tdUjk00eaTkcE
9x8c7fEZ8LLaV7p9IzFHnNXxPW+ynQFrbEDaGJ6Oi7RZowY3BFyEHrsEkI7NXN/s
Xo3jccdaqZop5rQTFxMk4Y1LF7bJFKkcIIqRnRQ/y//RNMB4l15LK3ugrNCvHauC
6Q8bXIcCq/glNPnlK+ZQY4ezQnyLm2r856IHsEeZ3uZfcYRlMm12xHt9XDMZLG6o
VT/jdgS3h0L5c5S459DL9YiqQuDOQEojhjzvhAUljGVB6op0PqyUgL4VjvXPI0Jf
YWk7HCl6dDnEIiXy/R8FtG5bAdP4uKR+aea+AIxjnhCwvoEa1GG+L6T0OPdzZcKy
1QIDAQAB
-----END PUBLIC KEY-----`;

type RsaPublicKey = { modulus: bigint; exponent: bigint; byteLength: number };

/** A small, strict DER reader for the existing RSA SubjectPublicKeyInfo only. */
class DerReader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  read(tag: number) {
    if (this.bytes[this.offset++] !== tag) throw new Error('Invalid RSA key');
    const first = this.bytes[this.offset++];
    if (first === undefined) throw new Error('Truncated RSA key');
    let length = first;
    if (first & 0x80) {
      const count = first & 0x7f;
      if (!count || count > 4 || this.bytes[this.offset] === 0) throw new Error('Invalid DER length');
      length = 0;
      for (let i = 0; i < count; i++) {
        const byte = this.bytes[this.offset++];
        if (byte === undefined) throw new Error('Truncated DER length');
        length = length * 256 + byte;
      }
      if (length < 128) throw new Error('Noncanonical DER length');
    }
    const end = this.offset + length;
    if (end > this.bytes.length) throw new Error('Truncated RSA key');
    const result = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return result;
  }

  finish() {
    if (this.offset !== this.bytes.length) throw new Error('Unexpected RSA key data');
  }
}

function bytesToBigInt(bytes: Uint8Array) {
  let result = 0n;
  for (const byte of bytes) result = (result << 8n) | BigInt(byte);
  return result;
}

function positiveInteger(bytes: Uint8Array) {
  if (!bytes.length || (bytes[0]! & 0x80)) throw new Error('Invalid RSA integer');
  if (bytes.length > 1 && bytes[0] === 0 && !(bytes[1]! & 0x80)) throw new Error('Noncanonical RSA integer');
  return bytesToBigInt(bytes);
}

function parsePublicKey(pem: string): RsaPublicKey {
  const match = /^-----BEGIN PUBLIC KEY-----\s+([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----\s*$/.exec(pem);
  if (!match) throw new Error('Invalid RSA public key');
  const binary = atob(match[1]!.replace(/\s/g, ''));
  const outer = new DerReader(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  const spki = new DerReader(outer.read(0x30));
  outer.finish();
  const algorithm = new DerReader(spki.read(0x30));
  // rsaEncryption OID 1.2.840.113549.1.1.1, with NULL parameters.
  if (Array.from(algorithm.read(0x06)).join(',') !== '42,134,72,134,247,13,1,1,1') throw new Error('Unsupported RSA algorithm');
  if (algorithm.read(0x05).length) throw new Error('Invalid RSA parameters');
  algorithm.finish();
  const bitString = spki.read(0x03);
  spki.finish();
  if (bitString[0] !== 0) throw new Error('Invalid RSA bit string');
  const rsaOuter = new DerReader(bitString.subarray(1));
  const rsa = new DerReader(rsaOuter.read(0x30));
  rsaOuter.finish();
  const modulus = positiveInteger(rsa.read(0x02));
  const exponent = positiveInteger(rsa.read(0x02));
  rsa.finish();
  const byteLength = Math.ceil(modulus.toString(2).length / 8);
  if (byteLength < 128 || byteLength > 512 || !(modulus & 1n) || exponent < 3n || !(exponent & 1n) || exponent > 0xffffffffn) {
    throw new Error('Unsupported RSA key parameters');
  }
  return { modulus, exponent, byteLength };
}

function publicExponentiation(value: bigint, key: RsaPublicKey) {
  let result = 1n;
  let base = value % key.modulus;
  let exponent = key.exponent;
  while (exponent) {
    if (exponent & 1n) result = (result * base) % key.modulus;
    base = (base * base) % key.modulus;
    exponent >>= 1n;
  }
  return result;
}

let workosKey: RsaPublicKey | undefined;

/** WorkOS requires RSAES-PKCS1-v1_5, which Web Crypto does not offer for encryption.
 * Only the public-key operation runs here; all padding entropy comes from Web Crypto.
 * The optional PEM supports independent cryptographic compatibility tests.
 */
export function encryptWorkosIdentity(value: string, publicKeyPem = WORKOS_IDENTITY_PUBLIC_KEY) {
  try {
    const random = globalThis.crypto;
    if (!random?.getRandomValues) throw new Error('Secure randomness unavailable');
    const key = publicKeyPem === WORKOS_IDENTITY_PUBLIC_KEY
      ? (workosKey ??= parsePublicKey(publicKeyPem))
      : parsePublicKey(publicKeyPem);
    const content = new TextEncoder().encode(value);
    if (content.length > key.byteLength - 11) throw new Error('Identity too long');
    const padded = new Uint8Array(key.byteLength);
    padded[1] = 2;
    const separator = key.byteLength - content.length - 1;
    const entropy = new Uint8Array(key.byteLength);
    let filled = 2;
    // Reject zero bytes rather than mapping them, keeping padding uniformly random.
    // Bound retries so a broken RNG cannot hang the worker.
    for (let batch = 0; filled < separator && batch < 32; batch++) {
      random.getRandomValues(entropy);
      for (const byte of entropy) {
        if (byte && filled < separator) padded[filled++] = byte;
      }
    }
    if (filled !== separator) throw new Error('Secure randomness failed');
    padded.set(content, separator + 1);
    let ciphertext = publicExponentiation(bytesToBigInt(padded), key);
    const output = new Uint8Array(key.byteLength);
    for (let i = output.length - 1; i >= 0; i--) {
      output[i] = Number(ciphertext & 0xffn);
      ciphertext >>= 8n;
    }
    return btoa(String.fromCharCode(...output));
  } catch {
    // Never include the identity, key input, or cryptographic implementation detail.
    throw new WorkosApiError('无法生成 WorkOS v2 身份凭证，请检查浏览器安全随机数支持和连接配置。');
  }
}
