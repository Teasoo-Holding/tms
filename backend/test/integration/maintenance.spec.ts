import { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import request from 'supertest';
import { bootApp, PASSWORD, resetDatabase, Session, sql } from './harness';
import { createOp, Fixtures, loadFixtures, observationOp, treePayload } from './fixtures';

// Own database state: the last test clears all data.
let app: INestApplication;
let f: Fixtures;
let admin: Session;
let officer: Session;

beforeAll(async () => {
  await resetDatabase();
  app = await bootApp();
  f = await loadFixtures();
  admin = await new Session(app, 'admin@tms.local').login();
  officer = await new Session(app, 'officer@tms.local').login();
});

afterAll(async () => {
  await app.close();
});

const sync = (s: Session, operations: unknown[]) => s.post('/sync/batches', { device_id: s.deviceId, operations }).expect(200);
const del = (s: Session, path: string) => request(app.getHttpServer()).delete(`/api/v1${path}`).set('Authorization', `Bearer ${(s as any).token}`);

describe('deleting configuration', () => {
  it('deletes unused reference data, refuses what trees use, and tells phones', async () => {
    const before = (await officer.get('/mobile/bootstrap').expect(200)).body.cursor;
    const unused = (await admin.post('/tree-species', { scientific_name: 'Unusedus plantus' }).expect(201)).body.id;
    await del(officer, `/tree-species/${unused}`).expect(403);
    await del(admin, `/tree-species/${unused}`).expect(200);
    const tombstones = (await officer.get(`/sync/changes?cursor=${before}`).expect(200)).body.changes.filter((c: any) => c.deleted);
    expect(tombstones).toEqual([expect.objectContaining({ entity_type: 'species', deleted: true, data: { id: unused } })]);

    await sync(officer, [createOp(treePayload(f, '501'))]);
    const used = await del(admin, `/tree-species/${f.speciesId}`).expect(409);
    expect(used.body.code).toBe('IN_USE');
    expect((await del(admin, `/tree-statuses/${f.status.ALIVE}`).expect(409)).body.code).toBe('IN_USE');
    const sector = await del(admin, `/sectors/${f.sectorId}`).expect(409);
    expect(sector.body.code).toBe('HAS_TREES');
    await del(admin, `/projects/${f.projectId}`).expect(409);
  });

  it('deletes an empty project with all its configuration', async () => {
    const p = (await admin.post('/projects', { name: 'Empty', short_code: 'EMP', physical_id_uniqueness: 'PROJECT' }).expect(201)).body.id;
    const y = (await admin.post(`/projects/${p}/planting-years`, { year_label: '2026' }).expect(201)).body.id;
    const corners = [{ latitude: 7, longitude: 3 }, { latitude: 7.01, longitude: 3 }, { latitude: 7.01, longitude: 3.01 }, { latitude: 7, longitude: 3.01 }];
    const s = (await admin.post(`/projects/${p}/sectors`, { planting_year_id: y, name: 'A', short_code: 'A1', corners }).expect(201)).body.id;
    await admin.post(`/sectors/${s}/sub-sectors`, { name: 'A-a', short_code: 'AA', corners }).expect(201);
    await admin.post(`/projects/${p}/share-links`, {}).expect(201);
    await del(admin, `/projects/${p}`).expect(200);
    expect(await sql('SELECT count(*)::int AS n FROM sectors WHERE project_id = $1', [p])).toEqual([{ n: 0 }]);
  });
});

describe('client share links', () => {
  let token: string;
  let linkId: string;
  it('shows one project read-only, without an account and without staff names', async () => {
    const link = (await admin.post(`/projects/${f.projectId}/share-links`, { label: 'Sponsor', expires_in_days: 30 }).expect(201)).body;
    token = link.token;
    linkId = link.id;
    expect(link.path).toBe(`/share/${token}`);
    const view = (await request(app.getHttpServer()).get(`/api/v1/share/${token}`).expect(200)).body;
    expect(view.project.id).toBe(f.projectId);
    expect(view.summary.totals).toBeDefined();
    expect(view.summary.officer_activity).toBeUndefined();
    // Trees planted per week with the running total, for the client's "planted over time" chart.
    const weeks = view.summary.planted_by_week;
    expect(weeks.length).toBeGreaterThan(0);
    expect(weeks[weeks.length - 1].cumulative).toBe(Number(view.summary.totals.planting_events));
    expect(weeks.every((w: any, i: number) => i === 0 || Date.parse(w.week) - Date.parse(weeks[i - 1].week) === 7 * 86_400_000)).toBe(true);
    expect(view.summary.by_vendor[0]).toHaveProperty('short_code');
    const csv = await request(app.getHttpServer()).get(`/api/v1/share/${token}/trees.csv`).expect(200);
    expect(csv.text).not.toContain('registered_by');
    await request(app.getHttpServer()).get(`/api/v1/share/${token}/report.xlsx`).expect(200).expect('Content-Type', /spreadsheetml/);
    const list = (await admin.get(`/projects/${f.projectId}/share-links`).expect(200)).body;
    expect(list[0].last_used_at).toBeTruthy();
    // Administrators can copy a working link again; the stored copy is encrypted, never the token itself.
    expect(list[0]).toMatchObject({ status: 'ACTIVE', path: `/share/${token}` });
    expect(list[0].token_encrypted).toBeUndefined();
    const [stored] = await sql('SELECT token_encrypted FROM project_share_links WHERE id = $1', [linkId]);
    expect(stored.token_encrypted).not.toContain(token);
    const all = (await admin.get('/share-links').expect(200)).body;
    expect(all.find((l: any) => l.id === linkId)).toMatchObject({ project_id: f.projectId, project_name: 'Trees for Life', path: `/share/${token}` });
    await officer.get('/share-links').expect(403);
  });

  it('stops working once revoked', async () => {
    await admin.post(`/share-links/${linkId}/revoke`).expect(200);
    const res = await request(app.getHttpServer()).get(`/api/v1/share/${token}`).expect(404);
    expect(res.body.code).toBe('LINK_INVALID');
    await request(app.getHttpServer()).get('/api/v1/share/not-a-token').expect(404);
    const all = (await admin.get('/share-links').expect(200)).body;
    expect(all.find((l: any) => l.id === linkId)).toMatchObject({ status: 'REVOKED', path: null });
  });
});

describe('exports and photos', () => {
  it('exports everything to one workbook for administrators only', async () => {
    await admin.get('/reports/export.xlsx').expect(200).expect('Content-Type', /spreadsheetml/);
    await officer.get('/reports/export.xlsx').expect(403);
  });

  it('makes a small thumbnail for each verified photo', async () => {
    const sharp = (await import('sharp')).default;
    const jpeg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#2e7d32' } }).jpeg({ quality: 90 }).toBuffer();
    const p = treePayload(f, '777');
    await sync(officer, [createOp(p)]);
    const session = await officer
      .post('/media/upload-sessions', {
        media_id: randomUUID(), tree_id: p.id, observation_id: p.initial_observation.id,
        checksum_sha256: createHash('sha256').update(jpeg).digest('hex'), byte_size: jpeg.length, mime_type: 'image/jpeg', captured_at: new Date().toISOString(),
      })
      .expect(201);
    const u = new URL(session.body.upload_url);
    await request(app.getHttpServer()).put(u.pathname + u.search).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
    await officer.post(`/media/${session.body.media.id}/complete`).expect(200);
    const view = (await officer.get(`/media/${session.body.media.id}/view-url?size=thumb`).expect(200)).body;
    expect(view.size).toBe('thumb');
    const t = new URL(view.url);
    const img = await request(app.getHttpServer()).get(t.pathname + t.search).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const meta = await sharp(img.body as Buffer).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(320);
    expect((img.body as Buffer).length).toBeLessThan(jpeg.length / 3);
  });
});

describe('clear all data', () => {
  it('needs the exact confirmation and the admin password', async () => {
    await officer.post('/admin/clear-data', { scope: 'FIELD_DATA', confirm: 'DELETE ALL DATA', password: PASSWORD }).expect(403);
    expect((await admin.post('/admin/clear-data', { scope: 'FIELD_DATA', confirm: 'delete', password: PASSWORD }).expect(400)).body.code).toBe('CONFIRMATION_REQUIRED');
    expect((await admin.post('/admin/clear-data', { scope: 'FIELD_DATA', confirm: 'DELETE ALL DATA', password: 'wrong' }).expect(401)).body.code).toBe('PASSWORD_INCORRECT');
  });

  it('clears field data, keeps configuration and accounts, and tells phones to reset', async () => {
    const genBefore = (await officer.get('/mobile/bootstrap').expect(200)).body.data_generation;
    await sql(`INSERT INTO species_images (species_id, object_key, thumb_key) SELECT id, 'species/x.jpg', 'species/x.thumb.jpg' FROM tree_species LIMIT 1`);
    await sync(officer, [observationOp((await sql('SELECT id FROM trees LIMIT 1'))[0].id, f.status.ALIVE)]);
    const res = (await admin.post('/admin/clear-data', { scope: 'FIELD_DATA', confirm: 'DELETE ALL DATA', password: PASSWORD }).expect(200)).body;
    expect(res.trees).toBeGreaterThan(0);
    expect(res.data_generation).toBe(genBefore + 1);
    expect(await sql('SELECT count(*)::int AS n FROM trees')).toEqual([{ n: 0 }]);
    expect((await sql('SELECT count(*)::int AS n FROM projects'))[0].n).toBeGreaterThan(0);
    expect(await sql('SELECT count(*)::int AS n FROM species_images')).toEqual([{ n: 1 }]); // reference photos stay
    const boot = (await officer.get('/mobile/bootstrap').expect(200)).body;
    expect(boot.data_generation).toBe(genBefore + 1);
    expect((await officer.get('/sync/changes?cursor=0&limit=1').expect(200)).body.data_generation).toBe(genBefore + 1);
  });

  it('can clear everything except accounts, keeping the Alive and Dead statuses', async () => {
    await admin.post('/admin/clear-data', { scope: 'EVERYTHING', confirm: 'DELETE ALL DATA', password: PASSWORD }).expect(200);
    expect(await sql('SELECT count(*)::int AS n FROM projects')).toEqual([{ n: 0 }]);
    expect(await sql('SELECT count(*)::int AS n FROM species_images')).toEqual([{ n: 0 }]);
    expect((await sql('SELECT code FROM tree_statuses ORDER BY sort_order')).map((r) => r.code)).toEqual(['ALIVE', 'DEAD']);
    expect((await sql('SELECT count(*)::int AS n FROM users'))[0].n).toBeGreaterThanOrEqual(4);
    expect((await sql(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'data.clear'`))[0].n).toBe(2);
  });
});
