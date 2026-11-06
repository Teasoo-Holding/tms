import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { bootApp, resetDatabase, Session, sql } from './harness';
import { createOp, Fixtures, loadFixtures, observationOp, treePayload } from './fixtures';

// The visits page grouped by day and field session, and the client link's trees, photos and areas.
let app: INestApplication;
let f: Fixtures;
let admin: Session;
let officer: Session;
const S1 = randomUUID();
const S2 = randomUUID();
const trees: Record<string, string> = {};
const observations: Record<string, string> = {};

const sync = (s: Session, operations: unknown[]) => s.post('/sync/batches', { device_id: s.deviceId, operations }).expect(200);
const register = async (s: Session, key: string, serial: string, observedAt: string, session?: string, extra: Record<string, unknown> = {}) => {
  const p = treePayload(f, serial, { ...extra, initial_observation: { id: randomUUID(), status_id: f.status.ALIVE, observed_at: observedAt, field_session_id: session } });
  const r = (await sync(s, [createOp(p)])).body.results[0];
  expect(r.status).toBe('ACCEPTED');
  trees[key] = p.id;
  observations[key] = p.initial_observation.id;
};
const pub = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`);

beforeAll(async () => {
  await resetDatabase();
  app = await bootApp();
  f = await loadFixtures();
  admin = await new Session(app, 'admin@tms.local').login();
  officer = await new Session(app, 'officer@tms.local').login();
  // 28 October: the officer's session S1 (two trees), the administrator's S2 (one tree), and a visit from an
  // older app without a session. 27 October: one tree. 23:30 UTC on the 28th is already the 29th in Lagos.
  await register(officer, 'a', '301', '2026-10-28T08:00:00Z', S1);
  await register(officer, 'b', '302', '2026-10-28T09:00:00Z', S1);
  await register(admin, 'c', '303', '2026-10-28T10:00:00Z', S2);
  await register(officer, 'd', '304', '2026-10-27T10:00:00Z', S1);
  await register(officer, 'e', '305', '2026-10-28T23:30:00Z', S1, { sub_sector_id: f.subB });
  const visit = observationOp(trees.a, f.status.DEAD, { observed_at: '2026-10-28T11:00:00Z', field_session_id: null });
  expect((await sync(officer, [visit])).body.results[0].status).toBe('ACCEPTED');
  observations.visit = visit.entity_id;
  await sql(
    `INSERT INTO tree_media (id, tree_id, observation_id, object_key, checksum_sha256, byte_size, mime_type, captured_at, upload_state, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, 1000, 'image/jpeg', '2026-10-28T08:01:00Z', 'VERIFIED', $6)`,
    [randomUUID(), trees.a, observations.a, `projects/${f.projectId}/trees/${trees.a}/photo`, 'a'.repeat(64), f.officerId],
  );
});

afterAll(async () => {
  await app.close();
});

describe('visit days', () => {
  const days = (query: string) => admin.get(`/reports/visit-days?project_id=${f.projectId}&${query}`).expect(200).then((r) => r.body);

  it('lists one row per project and day with collectors, sessions and counts', async () => {
    const r = await days('tz=UTC');
    expect(r).toMatchObject({ total: 2, tz: 'UTC', limit: 25, offset: 0 });
    expect(r.items.map((d: any) => d.date)).toEqual(['2026-10-28', '2026-10-27']);
    const day = r.items[0];
    expect(day).toMatchObject({
      project_id: f.projectId, project_name: 'Trees for Life', records: 5, trees_registered: 4, visits: 1, corrections: 0, photos: 1,
      collector_count: 2, sessions: 3, first_at: '2026-10-28T08:00:00.000Z', last_at: '2026-10-28T23:30:00.000Z',
    });
    expect(day.collectors.map((c: any) => c.user_name)).toEqual(['Ada Administrator', 'Femi Field Officer'].sort());
    // Days in the caller's time zone, paginated.
    const lagos = await days('tz=Africa/Lagos');
    expect(lagos.items.map((d: any) => [d.date, d.records])).toEqual([['2026-10-29', 1], ['2026-10-28', 4], ['2026-10-27', 1]]);
    const page = await days('tz=Africa/Lagos&limit=1&offset=1');
    expect(page).toMatchObject({ total: 3, items: [expect.objectContaining({ date: '2026-10-28' })] });
  });

  it('keeps a day when any record matches the filters, counting the matching records', async () => {
    const found = await days('q=302');
    expect(found.items).toEqual([expect.objectContaining({ date: '2026-10-28', records: 1, trees_registered: 1, collector_count: 1 })]);
    const mine = await days(`tz=UTC&recorded_by=${f.officerId}`);
    expect(mine.items.map((d: any) => [d.date, d.records, d.sessions])).toEqual([['2026-10-28', 4, 2], ['2026-10-27', 1, 1]]);
    const period = await days('from=2026-10-27&to=2026-10-27');
    expect(period.items.map((d: any) => d.date)).toEqual(['2026-10-27']);
    expect((await days(`sub_sector_id=${f.subB}`)).items.map((d: any) => d.records)).toEqual([1]);
    expect((await admin.get('/reports/visit-days?tz=Mars/Olympus').expect(400)).body.code).toBe('TIME_ZONE_UNKNOWN');
  });

  it('opens a day grouped by field session and collector, with its records', async () => {
    const d = (await admin.get(`/reports/visit-days/2026-10-28?project_id=${f.projectId}&tz=UTC`).expect(200)).body;
    expect(d).toMatchObject({ date: '2026-10-28', tz: 'UTC', project: { id: f.projectId } });
    // Without tz, days are WAT days.
    expect((await admin.get(`/reports/visit-days/2026-10-28?project_id=${f.projectId}`).expect(200)).body.tz).toBe('Africa/Lagos');
    expect(d.sessions.map((s: any) => [s.field_session_id, s.user_name, s.records])).toEqual([
      [S1, 'Femi Field Officer', 3],
      [S2, 'Ada Administrator', 1],
      [null, 'Femi Field Officer', 1],
    ]);
    expect(d.sessions[0]).toMatchObject({ trees_registered: 3, visits: 0, photos: 1, sectors: ['S01'], sub_sectors: ['S01/SS01', 'S01/SS02'], first_at: '2026-10-28T08:00:00.000Z' });

    const records = (await admin.get(`/reports/visit-days/2026-10-28/records?project_id=${f.projectId}&tz=UTC&field_session_id=${S1}&limit=2`).expect(200)).body;
    expect(records).toMatchObject({ total: 3, limit: 2, offset: 0 });
    expect(records.items.map((r: any) => r.physical_tree_id)).toHaveLength(2);
    expect(records.items[0]).toMatchObject({ tree_id: trees.a, status_code: 'ALIVE', is_initial: true, sector: 'S01', sub_sector: 'SS01' });
    expect(records.items[0].media).toEqual([expect.objectContaining({ upload_state: 'VERIFIED', observation_id: observations.a })]);
    const none = (await admin.get(`/reports/visit-days/2026-10-28/records?project_id=${f.projectId}&tz=UTC&field_session_id=none&recorded_by=${f.officerId}`).expect(200)).body;
    expect(none.items).toEqual([expect.objectContaining({ id: observations.visit, status_code: 'DEAD', is_initial: false })]);

    await admin.get(`/reports/visit-days/2026-02-30?project_id=${f.projectId}`).expect(400);
    await admin.get('/reports/visit-days/2026-10-28').expect(400); // project_id is required
  });

  it('exports the days and every record to Excel', async () => {
    const res = await admin.get(`/reports/visits.xlsx?project_id=${f.projectId}&tz=UTC`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Days', 'Visits']);
    expect(wb.getWorksheet('Days')!.rowCount).toBe(3);
    expect(wb.getWorksheet('Visits')!.rowCount).toBe(7);
  });
});

describe('paginated conflicts', () => {
  it('returns the whole list without limit (Android) and one page with it (portal)', async () => {
    expect(Array.isArray((await admin.get('/conflicts').expect(200)).body)).toBe(true);
    expect((await admin.get('/conflicts?status=RESOLVED&limit=10').expect(200)).body).toEqual({ items: [], total: 0, limit: 10, offset: 0 });
    await admin.get('/conflicts?status=ANY').expect(400);
  });
});

describe('client link: trees, photos and areas', () => {
  let token: string;
  let linkId: string;
  let other: { project: string; tree: string; media: string };

  beforeAll(async () => {
    const link = (await admin.post(`/projects/${f.projectId}/share-links`, { label: 'Sponsor' }).expect(201)).body;
    token = link.token;
    linkId = link.id;
    // A second project with a tree and a photo the link must not reach.
    const project = (await admin.post('/projects', { name: 'Other', short_code: 'OTH', physical_id_uniqueness: 'PROJECT', status: 'ACTIVE' }).expect(201)).body.id;
    const year = (await admin.post(`/projects/${project}/planting-years`, { year_label: '2026' }).expect(201)).body.id;
    const sector = (await admin.post(`/projects/${project}/sectors`, { planting_year_id: year, name: 'O', short_code: 'O1' }).expect(201)).body.id;
    const sub = (await admin.post(`/sectors/${sector}/sub-sectors`, { name: 'O a', short_code: 'OA' }).expect(201)).body.id;
    const vendor = (await admin.post('/vendors', { name: 'Other Vendor', short_code: 'OTV' }).expect(201)).body.id;
    await admin.post(`/planting-years/${year}/vendors`, { vendor_id: vendor }).expect(201);
    const [scheme] = await sql('SELECT id FROM tree_id_schemes WHERE project_id = $1 AND active', [project]);
    const p = treePayload(f, '1', {
      project_id: project, planting_year_id: year, sector_id: sector, sub_sector_id: sub, vendor_id: vendor, id_scheme_id: scheme.id, id_component_values: undefined,
    });
    expect((await sync(admin, [createOp(p)])).body.results[0]).toMatchObject({ status: 'ACCEPTED' });
    const media = randomUUID();
    await sql(
      `INSERT INTO tree_media (id, tree_id, observation_id, object_key, checksum_sha256, byte_size, mime_type, captured_at, upload_state)
       VALUES ($1, $2, $3, 'x/other', $4, 1000, 'image/jpeg', now(), 'VERIFIED')`,
      [media, p.id, p.initial_observation.id, 'b'.repeat(64)],
    );
    other = { project, tree: p.id, media };
  });

  it('lists, filters, searches and sorts the project’s trees', async () => {
    const all = (await pub(`/share/${token}/trees`).expect(200)).body;
    expect(all).toMatchObject({ total: 5, limit: 50, offset: 0 });
    expect(all.items.map((t: any) => t.physical_tree_id)).toEqual([...all.items.map((t: any) => t.physical_tree_id)].sort());
    expect(all.items.find((t: any) => t.id === trees.a)).toMatchObject({ status_code: 'DEAD', sector_code: 'S01', sub_sector_code: 'SS01', year_label: '2024', photos: 1 });
    expect((await pub(`/share/${token}/trees?q=303`).expect(200)).body.items.map((t: any) => t.id)).toEqual([trees.c]);
    expect((await pub(`/share/${token}/trees?status_id=${f.status.DEAD}`).expect(200)).body.total).toBe(1);
    expect((await pub(`/share/${token}/trees?sub_sector_id=${f.subB}`).expect(200)).body.items.map((t: any) => t.id)).toEqual([trees.e]);
    const desc = (await pub(`/share/${token}/trees?sort=tree_id&order=desc&limit=2&offset=1`).expect(200)).body;
    expect(desc.items).toHaveLength(2);
    expect(desc.items[0].physical_tree_id > desc.items[1].physical_tree_id).toBe(true);
    const view = (await pub(`/share/${token}`).expect(200)).body;
    expect(view.statuses.map((s: any) => s.code)).toEqual(expect.arrayContaining(['ALIVE', 'DEAD']));
    expect(view.species.map((s: any) => s.id)).toEqual([f.speciesId]);
  });

  it('gives the previous and next tree of the client’s list, with its filters and sort', async () => {
    const list = (await pub(`/share/${token}/trees?sort=tree_id&order=desc`).expect(200)).body.items.map((t: any) => t.id);
    expect((await pub(`/share/${token}/trees/${list[1]}/neighbours?sort=tree_id&order=desc`).expect(200)).body)
      .toEqual({ previous_id: list[0], next_id: list[2], position: 2, total: 5 });
    expect((await pub(`/share/${token}/trees/${trees.e}/neighbours?sub_sector_id=${f.subB}`).expect(200)).body)
      .toEqual({ previous_id: null, next_id: null, position: 1, total: 1 });
    // Another project's tree is never in the list.
    expect((await pub(`/share/${token}/trees/${other.tree}/neighbours`).expect(200)).body).toMatchObject({ position: null, previous_id: null, next_id: null });
    await pub(`/share/${token}/trees/${trees.a}/neighbours?sort=maintenance`).expect(400);
  });

  it('shows a tree with its visits and photos, only within the link’s project', async () => {
    const t = (await pub(`/share/${token}/trees/${trees.a}`).expect(200)).body;
    expect(t.observations.map((o: any) => o.status_code)).toEqual(['DEAD', 'ALIVE']);
    expect(t.media).toEqual([expect.objectContaining({ observation_id: observations.a, upload_state: 'VERIFIED' })]);
    const url = (await pub(`/share/${token}/media/${t.media[0].id}`).expect(200)).body;
    expect(url).toMatchObject({ size: 'full', expires_in: 300 });
    expect(url.url).toContain('/media/local/download');
    await pub(`/share/${token}/trees/${other.tree}`).expect(404);
    await pub(`/share/${token}/media/${other.media}`).expect(404);
    // Areas come from the density report: outlines, reference points, hectares and tree counts.
    const areas = (await pub(`/share/${token}/density`).expect(200)).body;
    expect(areas.sectors.find((s: any) => s.short_code === 'S01').registered_trees).toBe(5);
  });

  it('never shows who collected the data', async () => {
    // Every account's id, name and email, and every device id (usernames such as "admin" are ordinary words).
    const people = await sql(`SELECT id, full_name, email FROM users`);
    const devices = await sql(`SELECT id FROM devices`);
    const secrets = [...people.flatMap((u) => [u.id, u.full_name, u.email]), ...devices.map((d) => d.id)].filter(Boolean);
    const bodies = await Promise.all([
      pub(`/share/${token}`), pub(`/share/${token}/density`), pub(`/share/${token}/trees`), pub(`/share/${token}/trees?limit=500`),
      ...Object.values(trees).map((id) => pub(`/share/${token}/trees/${id}`)),
      pub(`/share/${token}/trees.csv`), pub(`/share/${token}/visits.csv`),
    ].map((r) => r.expect(200).then((res) => res.text)));
    expect(bodies.length).toBeGreaterThan(5);
    for (const text of bodies) {
      for (const s of secrets) expect(text).not.toContain(s);
      expect(text).not.toMatch(/recorded_by|registered_by|created_by|uploaded_by|user_id|device|email/);
    }
  });

  it('stops working once revoked', async () => {
    await admin.post(`/share-links/${linkId}/revoke`).expect(200);
    for (const path of ['/trees', `/trees/${trees.a}`, `/media/${randomUUID()}`]) {
      expect((await pub(`/share/${token}${path}`).expect(404)).body.code).toBe('LINK_INVALID');
    }
  });
});
