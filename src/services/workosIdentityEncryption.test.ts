// This browser-only project has no @types/node; these imports are test-only
// OpenSSL interoperability checks and never enter a browser/worker bundle.
// @ts-expect-error Node built-in types are not installed in this browser project.
import { constants, createPublicKey, generateKeyPairSync, privateDecrypt } from 'node:crypto';
// @ts-expect-error Node built-in types are not installed in this browser project.
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptWorkosIdentity, WORKOS_IDENTITY_PUBLIC_KEY } from './workosIdentityEncryption';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 });
const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString();

function rawDecryption(ciphertext: string) {
  // Independent OpenSSL private-key operation; no production private key is used.
  return privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, Buffer.from(ciphertext, 'base64'));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WorkOS worker-safe identity encryption', () => {
  it('preserves the existing production DER RSA modulus and exponent', () => {
    const parsed = createPublicKey(WORKOS_IDENTITY_PUBLIC_KEY).export({ format: 'jwk' });
    expect(Buffer.from(parsed.n!, 'base64url')).toHaveLength(256);
    expect(parsed.e).toBe('AQAB');
    expect(Buffer.from(encryptWorkosIdentity('user-uuid'), 'base64')).toHaveLength(256);
  });

  it.each(['user-1', '用户组织', '中文 🧭 café', ''])('encrypts %j with valid PKCS#1 v1.5 padding and UTF-8', (identity) => {
    const ciphertext = encryptWorkosIdentity(identity, pem);
    expect(Buffer.from(ciphertext, 'base64')).toHaveLength(256);
    const block = rawDecryption(ciphertext);
    expect(block.subarray(0, 2)).toEqual(Buffer.from([0, 2]));
    const separator = block.indexOf(0, 2);
    expect(separator).toBeGreaterThanOrEqual(10);
    expect(Array.from(block.subarray(2, separator)).every((byte) => byte !== 0)).toBe(true);
    expect(block.subarray(separator + 1)).toEqual(Buffer.from(identity, 'utf8'));
  });

  it('uses secure global randomness with no window and never calls Math.random', () => {
    vi.stubGlobal('window', undefined);
    const nativeCrypto = globalThis.crypto;
    const secureRandom = vi.fn((bytes: Uint8Array<ArrayBuffer>) => nativeCrypto.getRandomValues(bytes));
    vi.stubGlobal('crypto', { getRandomValues: secureRandom });
    const weakRandom = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Forbidden fallback'); });
    const first = encryptWorkosIdentity('user-uuid', pem);
    const second = encryptWorkosIdentity('user-uuid', pem);
    expect(first).not.toBe(second);
    expect(secureRandom).toHaveBeenCalled();
    expect(weakRandom).not.toHaveBeenCalled();
    expect(rawDecryption(first).subarray(-9).toString()).toBe('user-uuid');
  });

  it('rejects zero RNG bytes rather than biasing the padding', () => {
    const secureRandom = vi.fn((bytes: Uint8Array) => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = i % 2 ? 0 : 7;
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues: secureRandom });
    const block = rawDecryption(encryptWorkosIdentity('user-uuid', pem));
    const separator = block.indexOf(0, 2);
    expect(Array.from(block.subarray(2, separator)).every((byte) => byte === 7)).toBe(true);
    expect(secureRandom.mock.calls.length).toBeGreaterThan(1);
  });

  it('fails safely when secure randomness is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    const weakRandom = vi.spyOn(Math, 'random');
    expect(() => encryptWorkosIdentity('private-identity')).toThrow('安全随机数');
    expect(weakRandom).not.toHaveBeenCalled();
  });

  it('bounds retries if secure RNG returns only zero bytes', () => {
    const secureRandom = vi.fn((bytes: Uint8Array) => bytes.fill(0));
    vi.stubGlobal('crypto', { getRandomValues: secureRandom });
    expect(() => encryptWorkosIdentity('private-identity', pem)).toThrow('安全随机数');
    expect(secureRandom).toHaveBeenCalledTimes(32);
  });

  it('enforces the PKCS padding limit using UTF-8 byte length', () => {
    expect(rawDecryption(encryptWorkosIdentity('x'.repeat(245), pem)).indexOf(0, 2)).toBe(10);
    expect(() => encryptWorkosIdentity('x'.repeat(246), pem)).toThrow();
    expect(() => encryptWorkosIdentity('中'.repeat(82), pem)).toThrow();
  });

  it('rejects a different algorithm and malformed DER without leaking input', () => {
    const ecKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'pem', type: 'spki' }).toString();
    for (const invalid of [ecKey, 'private-key-input', pem.replace('MI', 'AA')]) {
      expect(() => encryptWorkosIdentity('private-identity', invalid)).toThrow('无法生成 WorkOS v2 身份凭证');
    }
  });

  it('does not expose RNG exceptions or the supplied identity', () => {
    vi.stubGlobal('crypto', { getRandomValues() { throw new Error('private-identity'); } });
    expect(() => encryptWorkosIdentity('private-identity', pem)).toThrow(expect.objectContaining({
      message: expect.not.stringContaining('private-identity'),
    }));
  });
});
