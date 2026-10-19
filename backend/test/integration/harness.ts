import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { randomUUID } from 'crypto';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://tms:tms@localhost:5432/tms_test';
process.env.DATABASE_URL = TEST_DB;
// Tests always use the local database and local photo store, even when a Neon .env.local is present.
process.env.DATABASE_URL_UNPOOLED = TEST_DB;
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_DIR = `${require('os').tmpdir()}/tms-test-media-${process.pid}`;
process.env.PUBLIC_BASE_URL = 'http://test.local';

export const PASSWORD = 'ChangeMe!2026';

export async function resetDatabase() {
  const db = new Client({ connectionString: TEST_DB });
  await db.connect();
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.end();
  const { migrate } = await import('../../src/database/migrate');
  const { seed } = await import('../../src/database/seed');
  await migrate(TEST_DB, () => undefined);
  await seed(TEST_DB, () => undefined);
}

export async function bootApp(): Promise<INestApplication> {
  const { createApp } = await import('../../src/app.factory');
  const app = await createApp();
  app.useLogger(false);
  await app.init();
  return app;
}

export class Session {
  token = '';
  refresh = '';
  deviceId = randomUUID();
  constructor(private readonly app: INestApplication, public readonly email: string) {}

  async login() {
    const res = await request(this.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: this.email, password: PASSWORD, device_id: this.deviceId, device_name: 'test' })
      .expect(200);
    this.token = res.body.access_token;
    this.refresh = res.body.refresh_token;
    return this;
  }

  get(path: string) {
    return request(this.app.getHttpServer()).get(`/api/v1${path}`).set('Authorization', `Bearer ${this.token}`);
  }
  post(path: string, body?: unknown) {
    return request(this.app.getHttpServer()).post(`/api/v1${path}`).set('Authorization', `Bearer ${this.token}`).send(body as object);
  }
  patch(path: string, body?: unknown) {
    return request(this.app.getHttpServer()).patch(`/api/v1${path}`).set('Authorization', `Bearer ${this.token}`).send(body as object);
  }
}

export async function sql(text: string, params: unknown[] = []) {
  const db = new Client({ connectionString: TEST_DB });
  await db.connect();
  try {
    return (await db.query(text, params)).rows;
  } finally {
    await db.end();
  }
}
