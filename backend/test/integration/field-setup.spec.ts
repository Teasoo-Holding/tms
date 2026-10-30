import { INestApplication } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { bootApp, resetDatabase, Session, sql } from './harness';

// Own app instance: sign-in is rate limited per client.
let app: INestApplication;
let admin: Session;
let officer: Session;
let projectId: string;

beforeAll(async () => {
  await resetDatabase();
  app = await bootApp();
  admin = await new Session(app, 'admin@tms.local').login();
  officer = await new Session(app, 'officer@tms.local').login();
  [{ id: projectId }] = await sql(`SELECT id FROM projects WHERE short_code = 'T4L'`);
});

afterAll(async () => {
  await app.close();
});

const refresh = (token: string) => request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refresh_token: token });

describe('sessions on poor networks', () => {
  it('issues a fresh pair when the response to a refresh was lost, and the lost token stops working', async () => {
    const s = await new Session(app, 'officer@tms.local').login();
    const lost = (await refresh(s.refresh).expect(200)).body; // succeeded on the server, never reached the phone
    const retried = (await refresh(s.refresh).expect(200)).body; // the phone retries with the token it still has
    expect(retried.refresh_token).not.toBe(lost.refresh_token);
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${retried.access_token}`).expect(200);
    // Retrying again (the second response was lost too) still works, and the session carries on from the newest pair.
    const again = (await refresh(s.refresh).expect(200)).body;
    const next = (await refresh(again.refresh_token).expect(200)).body;
    expect(next.refresh_token).toBeTruthy();
    // The pairs whose responses were lost no longer work.
    await refresh(lost.refresh_token).expect(401);
    await refresh(retried.refresh_token).expect(401);
  });

  it('still treats reuse after the new token was used as theft and ends the whole session', async () => {
    const s = await new Session(app, 'officer@tms.local').login();
    const first = (await refresh(s.refresh).expect(200)).body;
    const second = (await refresh(first.refresh_token).expect(200)).body; // the new token was used
    await refresh(s.refresh).expect(401); // the old one comes back: genuine reuse
    await refresh(second.refresh_token).expect(401); // the family is revoked
  });

  it('treats an old token as reuse once a later token in the chain was used', async () => {
    const s = await new Session(app, 'officer@tms.local').login();
    const first = (await refresh(s.refresh).expect(200)).body;
    const second = (await refresh(first.refresh_token).expect(200)).body;
    await refresh(second.refresh_token).expect(200);
    await refresh(first.refresh_token).expect(401);
  });

  it('refuses retries for a deactivated user, a revoked device and an expired session', async () => {
    const created = await admin.post('/users', { email: 'flaky@tms.local', full_name: 'Flaky', role: 'FIELD_OFFICER', password: 'ChangeMe!2026' }).expect(201);
    const s = await new Session(app, 'flaky@tms.local').login();
    await refresh(s.refresh).expect(200);
    await admin.patch(`/users/${created.body.id}`, { active: false }).expect(200);
    await refresh(s.refresh).expect(401);

    const r = await new Session(app, 'officer@tms.local').login();
    await refresh(r.refresh).expect(200);
    await admin.post(`/devices/${r.deviceId}/revoke`).expect(201);
    await refresh(r.refresh).expect(401);

    const d = await new Session(app, 'officer@tms.local').login();
    await refresh(d.refresh).expect(200);
    await sql('UPDATE refresh_sessions SET expires_at = now() - interval \'1 minute\' WHERE token_hash = encode(sha256($1::bytea), \'hex\')', [d.refresh]);
    expect((await refresh(d.refresh).expect(401)).body.code).toBe('SESSION_EXPIRED');
  });

  it('keeps the field app signed in for 30 days offline and 90 days between refreshes by default', async () => {
    const body = (await refresh(officer.refresh).expect(200)).body;
    officer.refresh = body.refresh_token;
    const days = (iso: string) => Math.round((new Date(iso).getTime() - Date.now()) / 86400_000);
    expect(days(body.offline_valid_until)).toBe(30);
    expect(days(body.refresh_token_expires_at)).toBe(90);
  });
});

describe('default height unit', () => {
  it('is cm until an administrator changes it, and phones receive it with bootstrap and every change page', async () => {
    expect((await admin.get('/admin/settings').expect(200)).body).toEqual({ height_unit: 'cm' });
    const boot = (await officer.get('/mobile/bootstrap').expect(200)).body;
    expect(boot.settings).toEqual({ height_unit: 'cm' });

    expect((await admin.patch('/admin/settings', { height_unit: 'ft' }).expect(200)).body).toEqual({ height_unit: 'ft' });
    expect((await admin.get('/admin/settings').expect(200)).body).toEqual({ height_unit: 'ft' });
    const page = (await officer.get(`/sync/changes?cursor=${boot.cursor}`).expect(200)).body;
    expect(page.settings).toEqual({ height_unit: 'ft' });
    // Also on a page with no changes at all.
    expect((await officer.get(`/sync/changes?cursor=${page.next_cursor}`).expect(200)).body.settings).toEqual({ height_unit: 'ft' });

    const [log] = await sql(`SELECT before, after FROM audit_logs WHERE action = 'settings.update' ORDER BY created_at DESC LIMIT 1`);
    expect(log).toEqual({ before: { height_unit: 'cm' }, after: { height_unit: 'ft' } });
  });

  it('accepts only cm, m, in or ft, and only from administrators', async () => {
    expect((await admin.patch('/admin/settings', { height_unit: 'mm' }).expect(400)).body.code).toBe('VALIDATION_FAILED');
    await admin.patch('/admin/settings', { other: 1 }).expect(400);
    await officer.get('/admin/settings').expect(403);
    await officer.patch('/admin/settings', { height_unit: 'm' }).expect(403);
    await admin.patch('/admin/settings', { height_unit: 'cm' }).expect(200);
  });
});

describe('generating sectors and sub-sectors', () => {
  let yearId: string;

  it('creates numbered sectors, each with numbered sub-sectors, without GPS, and phones receive them', async () => {
    yearId = (await admin.post(`/projects/${projectId}/planting-years`, { year_label: '2040' }).expect(201)).body.id;
    const boot = (await officer.get('/mobile/bootstrap').expect(200)).body;
    const res = await admin.post(`/planting-years/${yearId}/areas/generate`, { sectors: 3 }).expect(201);
    expect(res.body).toEqual({ created_sectors: 3, created_sub_sectors: 12 });

    const areas = (await admin.get(`/projects/${projectId}/areas?planting_year_id=${yearId}`).expect(200)).body.filter((s: any) => s.planting_year_id === yearId);
    expect(areas.map((s: any) => [s.short_code, s.name])).toEqual([['S1', 'Sector 1'], ['S2', 'Sector 2'], ['S3', 'Sector 3']]);
    expect(areas[0].sub_sectors.map((ss: any) => [ss.short_code, ss.name])).toEqual([
      ['SS1', 'Sub-sector 1'], ['SS2', 'Sub-sector 2'], ['SS3', 'Sub-sector 3'], ['SS4', 'Sub-sector 4'],
    ]);
    expect(areas[0]).toMatchObject({ reference_latitude: null, reference_longitude: null, boundary: null, active: true });

    const changes = (await officer.get(`/sync/changes?cursor=${boot.cursor}`).expect(200)).body.changes;
    expect(changes.filter((c: any) => c.entity_type === 'sector' && c.data.planting_year_id === yearId)).toHaveLength(3);
    expect(changes.filter((c: any) => c.entity_type === 'sub_sector')).toHaveLength(12);
    const [log] = await sql(`SELECT metadata FROM audit_logs WHERE action = 'areas.generate'`);
    expect(log.metadata).toMatchObject({ sectors: 3, sub_sectors_per_sector: 4, created_sectors: 3, created_sub_sectors: 12 });
  });

  it('skips codes that already exist and never renames, so it can add more later', async () => {
    const areas = (await admin.get(`/projects/${projectId}/areas?planting_year_id=${yearId}`).expect(200)).body;
    const s2 = areas.find((s: any) => s.short_code === 'S2');
    await admin.patch(`/sectors/${s2.id}`, { name: 'River bank' }).expect(200);
    const res = await admin.post(`/planting-years/${yearId}/areas/generate`, { sectors: 5, sub_sectors_per_sector: 6 }).expect(201);
    // S4 and S5 are new (6 each); S1–S3 keep their 4 and gain SS5 and SS6.
    expect(res.body).toEqual({ created_sectors: 2, created_sub_sectors: 2 * 6 + 3 * 2 });
    const after = (await admin.get(`/projects/${projectId}/areas?planting_year_id=${yearId}`).expect(200)).body.filter((s: any) => s.planting_year_id === yearId);
    expect(after).toHaveLength(5);
    expect(after.find((s: any) => s.id === s2.id).name).toBe('River bank');
    expect(after.every((s: any) => s.sub_sectors.length === 6)).toBe(true);
    // Sector codes are per planting year: another year gets its own S1.
    expect((await sql(`SELECT count(*)::int AS n FROM sectors WHERE short_code = 'S1'`))[0].n).toBe(1);
    const other = (await admin.post(`/projects/${projectId}/planting-years`, { year_label: '2041' }).expect(201)).body.id;
    expect((await admin.post(`/planting-years/${other}/areas/generate`, { sectors: 1, sub_sectors_per_sector: 1 }).expect(201)).body).toEqual({
      created_sectors: 1,
      created_sub_sectors: 1,
    });
  });

  it('validates the numbers, the planting year and the role', async () => {
    for (const body of [{}, { sectors: 0 }, { sectors: 201 }, { sectors: 2.5 }, { sectors: '3' }, { sectors: 3, sub_sectors_per_sector: 27 }, { sectors: 3, sub_sectors_per_sector: 0 }]) {
      expect((await admin.post(`/planting-years/${yearId}/areas/generate`, body).expect(400)).body.code).toBe('VALIDATION_FAILED');
    }
    await admin.post('/planting-years/00000000-0000-4000-8000-000000000000/areas/generate', { sectors: 1 }).expect(404);
    await admin.post('/planting-years/not-a-uuid/areas/generate', { sectors: 1 }).expect(400);
    await officer.post(`/planting-years/${yearId}/areas/generate`, { sectors: 1 }).expect(403);
  });

  it('migration 011 runs again safely and keeps the chosen unit', async () => {
    await admin.patch('/admin/settings', { height_unit: 'm' }).expect(200);
    await sql(fs.readFileSync(path.resolve(__dirname, '../../migrations/011_resilient_sessions_and_settings.sql'), 'utf8'));
    expect((await admin.get('/admin/settings').expect(200)).body).toEqual({ height_unit: 'm' });
  });
});
