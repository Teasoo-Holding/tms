import { createSign, generateKeyPairSync } from 'crypto';
import { verifyGoogleIdToken } from '../../src/auth/google';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = async () => ({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1' } as any] });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
function token(claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const head = b64({ alg: 'RS256', kid: 'k1', ...header });
  const body = b64({ iss: 'accounts.google.com', aud: CLIENT_ID, iat: now, exp: now + 600, sub: 's1', email: 'A@Example.com', email_verified: true, ...claims });
  return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url')}`;
}
const check = (t: string) => verifyGoogleIdToken(t, CLIENT_ID, keys);

describe('verifyGoogleIdToken', () => {
  it('accepts a valid token and lower-cases the email', async () => {
    expect(await check(token({ name: 'Ada' }))).toEqual({ sub: 's1', email: 'a@example.com', name: 'Ada' });
  });

  it('rejects wrong audience, issuer, expiry, unverified email, unknown key, other algorithms and tampering', async () => {
    expect(await check(token({ aud: 'other' }))).toBeNull();
    expect(await check(token({ iss: 'https://evil.example' }))).toBeNull();
    expect(await check(token({ exp: now - 3600 }))).toBeNull();
    expect(await check(token({ iat: now + 3600 }))).toBeNull();
    expect(await check(token({ email_verified: false }))).toBeNull();
    expect(await check(token({}, { kid: 'nope' }))).toBeNull();
    expect(await check(token({}, { alg: 'none' }))).toBeNull();
    const [h, , sig] = token({}).split('.');
    expect(await check(`${h}.${b64({ iss: 'accounts.google.com', aud: CLIENT_ID, exp: now + 600, sub: 'admin', email: 'x@y.z', email_verified: true })}.${sig}`)).toBeNull();
    expect(await check('not-a-token')).toBeNull();
  });
});
