// The harness first: it points the app's config at the test database before config is loaded.
import { bootApp, resetDatabase, sql } from './harness';
import { INestApplication } from '@nestjs/common';
import { createSign, generateKeyPairSync } from 'crypto';
import request from 'supertest';
import { AuthService } from '../../src/auth/auth.service';
import { config } from '../../src/config';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims: Record<string, unknown>, kid = 'k1') {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, iat: now, exp: now + 600, email_verified: true, ...claims });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

let app: INestApplication;
beforeAll(async () => {
  await resetDatabase();
  app = await bootApp();
  app.get(AuthService).googleKeys = async () => ({ keys: [jwk as any] });
});
afterAll(async () => {
  (config as any).googleClientId = null;
  await app.close();
});

const google = (credential: string) => request(app.getHttpServer()).post('/api/v1/auth/google').send({ credential });

describe('sign in with Google', () => {
  it('is off until GOOGLE_CLIENT_ID is set', async () => {
    (config as any).googleClientId = null;
    expect((await request(app.getHttpServer()).get('/api/v1/auth/options').expect(200)).body).toEqual({ google_client_id: null });
    expect((await google(token({ sub: 'g1', email: 'officer@tms.local' })).expect(404)).body.code).toBe('GOOGLE_SIGN_IN_OFF');
    (config as any).googleClientId = CLIENT_ID;
    expect((await request(app.getHttpServer()).get('/api/v1/auth/options').expect(200)).body).toEqual({ google_client_id: CLIENT_ID });
  });

  it('signs in an existing user by verified email and links the Google account', async () => {
    const r = await google(token({ sub: 'g1', email: 'Officer@tms.local' })).expect(200);
    expect(r.body.user.email).toBe('officer@tms.local');
    expect(r.body.access_token).toBeTruthy();
    expect((await sql(`SELECT google_sub FROM users WHERE email = 'officer@tms.local'`))[0].google_sub).toBe('g1');
    // Linked: later sign-ins match the Google account even if its email changes.
    expect((await google(token({ sub: 'g1', email: 'new-address@gmail.com' })).expect(200)).body.user.email).toBe('officer@tms.local');
  });

  it('never creates accounts, re-links another Google account, or accepts an unverified email', async () => {
    expect((await google(token({ sub: 'g2', email: 'stranger@gmail.com' })).expect(401)).body.code).toBe('GOOGLE_ACCOUNT_UNKNOWN');
    // officer@ is linked to g1, so g2 with the same email is refused.
    expect((await google(token({ sub: 'g2', email: 'officer@tms.local' })).expect(401)).body.code).toBe('GOOGLE_ACCOUNT_UNKNOWN');
    // Bad tokens are covered by test/unit/google.spec.ts (sign-in is rate limited).
    expect((await google(token({ sub: 'g3', email: 'admin@tms.local', email_verified: false })).expect(401)).body.code).toBe('GOOGLE_TOKEN_INVALID');
    expect((await sql(`SELECT count(*)::int AS n FROM users WHERE google_sub = 'g3'`))[0].n).toBe(0);
  });

  it('refuses deactivated accounts', async () => {
    await sql(`UPDATE users SET active = false WHERE email = 'exec@tms.local'`);
    expect((await google(token({ sub: 'g4', email: 'exec@tms.local' })).expect(401)).body.code).toBe('ACCOUNT_DISABLED');
  });
});
