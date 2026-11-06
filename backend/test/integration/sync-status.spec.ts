import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { bootApp, resetDatabase, Session, sql } from './harness';
import { createOp, Fixtures, loadFixtures, treePayload } from './fixtures';

// Own database state: phone sync status, data freshness, and project form rules.
let app: INestApplication;
let f: Fixtures;
let admin: Session;
let officer: Session;
let officer2: Session;
let exec: Session;

beforeAll(async () => {
  await resetDatabase();
  app = await bootApp();
  f = await loadFixtures();
  admin = await new Session(app, 'admin@tms.local').login();
  officer = await new Session(app, 'officer@tms.local').login();
  officer2 = await new Session(app, 'officer2@tms.local').login();
  exec = await new Session(app, 'exec@tms.local').login();
});

afterAll(async () => {
  await app.close();
});

const status = (s: Session, body: Record<string, unknown>) => s.post('/sync/status', { device_id: s.deviceId, ...body });

describe('phone sync status', () => {
  it('stores pending records and the last sync on the device row', async () => {
    const before = (await officer.get('/reports/freshness').expect(403)).body;
    expect(before.code).toBe('FORBIDDEN');
    await status(officer, { pending_operations: 14, pending_photos: 3, oldest_pending_at: '2026-11-06T08:10:00Z', app_version: '1.0.15', last_sync_at: '2026-11-06T08:00:00Z' })
      .expect(204);
    const [d] = await sql('SELECT * FROM devices WHERE id = $1', [officer.deviceId]);
    expect(d).toMatchObject({ pending_operations: 14, pending_photos: 3, app_version: '1.0.15', status_user_id: f.officerId });
    expect(d.oldest_pending_at.toISOString()).toBe('2026-11-06T08:10:00.000Z');
    expect(d.last_sync_at.toISOString()).toBe('2026-11-06T08:00:00.000Z');
    expect(d.status_reported_at).toBeTruthy();
  });

  it('takes the device from the session, never moves last_sync_at back or into the future, and clears the oldest time when nothing waits', async () => {
    // No device_id in the body: the access token names the device.
    await officer.post('/sync/status', { pending_operations: 0, pending_photos: 0, oldest_pending_at: '2026-11-06T08:10:00Z', last_sync_at: '2020-01-01T00:00:00Z' }).expect(204);
    let [d] = await sql('SELECT * FROM devices WHERE id = $1', [officer.deviceId]);
    expect(d.last_sync_at.toISOString()).toBe('2026-11-06T08:00:00.000Z');
    expect(d.oldest_pending_at).toBeNull();
    expect(d.app_version).toBe('1.0.15');
    await status(officer, { pending_operations: 0, pending_photos: 0, last_sync_at: '2999-01-01T00:00:00Z' }).expect(204);
    [d] = await sql('SELECT * FROM devices WHERE id = $1', [officer.deviceId]);
    expect(d.last_sync_at.getTime()).toBeLessThanOrEqual(Date.now());
    // A null last sync (failed run) keeps the stored one.
    await status(officer, { pending_operations: 2, pending_photos: 0, oldest_pending_at: null, last_sync_at: null }).expect(204);
    const [again] = await sql('SELECT last_sync_at, pending_operations FROM devices WHERE id = $1', [officer.deviceId]);
    expect(again).toEqual({ last_sync_at: d.last_sync_at, pending_operations: 2 });
  });

  it('refuses invalid counts, another device and other roles', async () => {
    expect((await status(officer, { pending_operations: -1, pending_photos: 0 }).expect(400)).body.code).toBe('VALIDATION_FAILED');
    await status(officer, { pending_operations: 1 }).expect(400);
    expect((await officer.post('/sync/status', { device_id: officer2.deviceId, pending_operations: 0, pending_photos: 0 }).expect(400)).body.code).toBe('DEVICE_MISMATCH');
    await exec.post('/sync/status', { device_id: exec.deviceId, pending_operations: 0, pending_photos: 0 }).expect(403);
    // A token without a device (web sign-in) must name a device it owns.
    const web = (await request(app.getHttpServer()).post('/api/v1/auth/login').send({ login: 'admin', password: 'ChangeMe!2026' }).expect(200)).body.access_token;
    const noDevice = (body: object) => request(app.getHttpServer()).post('/api/v1/sync/status').set('Authorization', `Bearer ${web}`).send(body);
    expect((await noDevice({ pending_operations: 0, pending_photos: 0 }).expect(400)).body.code).toBe('DEVICE_REQUIRED');
    expect((await noDevice({ device_id: randomUUID(), pending_operations: 0, pending_photos: 0 }).expect(403)).body.code).toBe('DEVICE_NOT_REGISTERED');
    await noDevice({ device_id: admin.deviceId, pending_operations: 0, pending_photos: 0 }).expect(204);
  });
});

describe('data freshness', () => {
  it('reports the latest phone sync and the phones with unsent records', async () => {
    await officer.post('/sync/batches', { device_id: officer.deviceId, operations: [createOp(treePayload(f, '1'))] }).expect(200);
    await status(officer, { pending_operations: 14, pending_photos: 3, oldest_pending_at: '2026-11-06T08:10:00Z', last_sync_at: null }).expect(204);
    await status(officer2, { pending_operations: 0, pending_photos: 5, oldest_pending_at: '2026-11-05T17:00:00Z' }).expect(204);
    const r = (await admin.get(`/reports/freshness?project_id=${f.projectId}`).expect(200)).body;
    const [{ last_sync_at }] = await sql('SELECT last_sync_at FROM devices WHERE id = $1', [officer.deviceId]);
    expect(r.last_sync_at).toBe(last_sync_at.toISOString());
    expect(r).toMatchObject({ devices_with_pending: 2, pending_operations: 14, pending_photos: 8 });
    const femi = r.devices.find((d: any) => d.device_id === officer.deviceId);
    expect(femi).toMatchObject({ user_name: 'Femi Field Officer', pending_operations: 14, pending_photos: 3, oldest_pending_at: '2026-11-06T08:10:00.000Z', app_version: '1.0.15' });
    expect(femi.status_reported_at).toBeTruthy();
    // Phones with unsent records come first.
    expect(r.devices.slice(0, 2).map((d: any) => d.device_id).sort()).toEqual([officer.deviceId, officer2.deviceId].sort());
    // The administrator's phone has not recorded in this project and is not assigned to it.
    expect(r.devices.some((d: any) => d.device_id === admin.deviceId)).toBe(false);
    expect((await admin.get('/reports/freshness').expect(200)).body.devices.some((d: any) => d.device_id === admin.deviceId)).toBe(true);
  });

  it('scopes executives to their projects and handles phones that never reported', async () => {
    const other = (await admin.post('/projects', { name: 'Elsewhere', short_code: 'ELS', physical_id_uniqueness: 'PROJECT' }).expect(201)).body.id;
    await exec.get(`/reports/freshness?project_id=${other}`).expect(403);
    const mine = (await exec.get('/reports/freshness').expect(200)).body;
    expect(mine.devices.map((d: any) => d.device_id)).toEqual(expect.arrayContaining([officer.deviceId, officer2.deviceId]));
    expect(mine.devices.some((d: any) => d.device_id === admin.deviceId)).toBe(false);
    // An older app never reports: its counts are null, not zero, and it is not counted as pending.
    const old = await new Session(app, 'officer@tms.local').login();
    const r = (await exec.get(`/reports/freshness?project_id=${f.projectId}`).expect(200)).body;
    expect(r.devices.find((d: any) => d.device_id === old.deviceId)).toMatchObject({ pending_operations: null, pending_photos: null, status_reported_at: null });
    expect(r.devices_with_pending).toBe(2);
  });

  it('falls back to the latest record received when no phone has synced', async () => {
    await sql('UPDATE devices SET last_sync_at = NULL');
    const r = (await admin.get(`/reports/freshness?project_id=${f.projectId}`).expect(200)).body;
    const [{ at }] = await sql('SELECT max(synced_at) AS at FROM tree_observations');
    expect(r.last_sync_at).toBe(at.toISOString());
    const empty = (await admin.get(`/reports/freshness?project_id=${(await sql(`SELECT id FROM projects WHERE short_code = 'ELS'`))[0].id}`).expect(200)).body;
    expect(empty).toMatchObject({ last_sync_at: null, devices: [], devices_with_pending: 0, pending_operations: 0, pending_photos: 0 });
  });
});

describe('project form rules', () => {
  it('checks short codes and refuses duplicates with 409', async () => {
    expect((await admin.get('/projects/short-code-available?code=t4l').expect(200)).body).toEqual({ code: 'T4L', available: false });
    expect((await admin.get('/projects/short-code-available?code=NEW1').expect(200)).body).toEqual({ code: 'NEW1', available: true });
    await admin.get('/projects/short-code-available?code=BAD CODE').expect(400);
    await exec.get('/projects/short-code-available?code=NEW1').expect(403);
    const dup = await admin.post('/projects', { name: 'Again', short_code: 't4l', physical_id_uniqueness: 'PROJECT' }).expect(409);
    expect(dup.body.code).toBe('SHORT_CODE_TAKEN');
    expect(dup.body.message).toContain('T4L');
  });

  it('keeps the short code fixed after creation', async () => {
    await admin.patch(`/projects/${f.projectId}`, { short_code: 'T4L', name: 'Trees for Life' }).expect(200);
    expect((await admin.patch(`/projects/${f.projectId}`, { short_code: 'T5L' }).expect(409)).body.code).toBe('SHORT_CODE_FIXED');
  });

  it('refuses an end date before the start date for projects and planting years', async () => {
    const bad = await admin.post('/projects', { name: 'Backwards', short_code: 'BWD', physical_id_uniqueness: 'PROJECT', start_date: '2026-05-01', end_date: '2026-04-30' }).expect(400);
    expect(bad.body.code).toBe('DATE_RANGE_INVALID');
    await admin.post('/projects', { name: 'Same day', short_code: 'SDY', physical_id_uniqueness: 'PROJECT', start_date: '2026-05-01', end_date: '2026-05-01' }).expect(201);
    // Updates are checked against the stored dates (T4L starts 2024-01-01).
    expect((await admin.patch(`/projects/${f.projectId}`, { end_date: '2023-12-31' }).expect(400)).body.code).toBe('DATE_RANGE_INVALID');
    expect((await admin.post(`/projects/${f.projectId}/planting-years`, { year_label: '2030', start_date: '2030-02-01', end_date: '2030-01-01' }).expect(400)).body.code)
      .toBe('DATE_RANGE_INVALID');
    expect((await admin.patch(`/planting-years/${f.year2024}`, { end_date: '2023-01-01' }).expect(400)).body.code).toBe('DATE_RANGE_INVALID');
  });
});
