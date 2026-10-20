import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { bootApp, PASSWORD, resetDatabase } from './harness';

// Own app instance: sign-in is rate limited per client, and the main suite already signs in several times.
let app: INestApplication;

beforeAll(async () => {
  await resetDatabase();
  app = await bootApp();
});

afterAll(async () => {
  await app.close();
});

const login = (body: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/api/v1/auth/login').send({ password: PASSWORD, device_id: randomUUID(), ...body });

describe('sign-in identifiers', () => {
  it('accepts a username (any case), an email or a phone number in local or international form', async () => {
    const byUsername = await login({ login: 'FEMI' }).expect(200);
    expect(byUsername.body.user.username).toBe('femi');
    const id = byUsername.body.user.id;
    expect((await login({ login: 'officer@tms.local' }).expect(200)).body.user.id).toBe(id);
    expect((await login({ login: '0803 000 0001' }).expect(200)).body.user.id).toBe(id);
    expect((await login({ login: '+234 803-000-0001' }).expect(200)).body.user.id).toBe(id);
  });

  it('rejects unknown identifiers and still accepts older apps that send "email"', async () => {
    const bad = await login({ login: 'nobody' }).expect(401);
    expect(bad.body.code).toBe('INVALID_CREDENTIALS');
    await login({ email: 'eli' }).expect(200);
  });
});
