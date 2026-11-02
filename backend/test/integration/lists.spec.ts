import { INestApplication } from '@nestjs/common';
import { bootApp, resetDatabase, Session } from './harness';
import { createOp, Fixtures, loadFixtures, observationOp, treePayload } from './fixtures';

// The portal's list screens: tree filters and sorting, audit log search, and the Excel exports.
let app: INestApplication;
let f: Fixtures;
let admin: Session;
let sector25: string;
let sub25: string;
const ids: Record<string, string> = {};

const sync = (operations: unknown[]) => admin.post('/sync/batches', { device_id: admin.deviceId, operations }).expect(200);
const trees = (query: string) => admin.get(`/trees?${query}`).expect(200).then((r) => r.body);
const physical = (body: any) => body.items.map((t: any) => t.physical_tree_id);

beforeAll(async () => {
  await resetDatabase();
  app = await bootApp();
  f = await loadFixtures();
  admin = await new Session(app, 'admin@tms.local').login();
  // 2025 has its own survey: sector S02 with sub-sector SS1. The seeded S01 (SS01, SS02) is not tied to a year.
  sector25 = (await admin.post(`/projects/${f.projectId}/sectors`, { planting_year_id: f.year2025, name: 'South', short_code: 'S02' }).expect(201)).body.id;
  sub25 = (await admin.post(`/sectors/${sector25}/sub-sectors`, { name: 'Sub-sector 1', short_code: 'SS1' }).expect(201)).body.id;
  const in2025 = { planting_year_id: f.year2025, sector_id: sector25, sub_sector_id: sub25, id_component_values: { PROJECT_CODE: 'T4L', PLANTING_YEAR: '2025' } };
  const payloads = {
    a: treePayload(f, '101'),
    b: treePayload(f, '102'),
    c: treePayload(f, '103', { sub_sector_id: f.subB }),
    d: treePayload(f, '201', in2025),
    e: treePayload(f, '202', in2025),
  };
  const res = await sync(Object.values(payloads).map(createOp));
  expect(res.body.results.every((r: any) => r.status === 'ACCEPTED')).toBe(true);
  Object.entries(payloads).forEach(([k, p]) => (ids[k] = p.id));
  // One tree is later found dead (a newer visit), so status and last-visit sorting have something to order.
  await sync([observationOp(ids.c, f.status.DEAD)]);
});

afterAll(async () => {
  await app.close();
});

describe('tree list filters', () => {
  it('filters by planting year, sector and sub-sector, alone and combined, with a matching total', async () => {
    expect((await trees('')).total).toBe(5);
    const y25 = await trees(`planting_year_id=${f.year2025}`);
    expect(y25.total).toBe(2);
    expect(y25.items.every((t: any) => t.planting_year_id === f.year2025)).toBe(true);
    expect((await trees(`planting_year_id=${f.year2024}`)).total).toBe(3);
    expect((await trees(`sector_id=${f.sectorId}`)).total).toBe(3);
    expect((await trees(`sector_id=${sector25}`)).total).toBe(2);
    const sub = await trees(`sector_id=${f.sectorId}&sub_sector_id=${f.subB}`);
    expect(sub.items.map((t: any) => t.id)).toEqual([ids.c]);
    // Combined with the project, status and the tree ID search.
    expect((await trees(`project_id=${f.projectId}&planting_year_id=${f.year2024}&sector_id=${f.sectorId}&status_id=${f.status.ALIVE}`)).total).toBe(2);
    const one = physical(await trees(`planting_year_id=${f.year2025}`))[0];
    expect((await trees(`planting_year_id=${f.year2025}&q=${encodeURIComponent(one)}`)).total).toBe(1);
    // A sector from another year's survey matches nothing in this year.
    expect((await trees(`planting_year_id=${f.year2024}&sector_id=${sector25}`)).total).toBe(0);
  });

  it('refuses malformed filter values', async () => {
    await admin.get('/trees?planting_year_id=2025').expect(400);
    await admin.get('/trees?sector_id=S01').expect(400);
  });
});

describe('tree list sorting', () => {
  it('sorts by tree ID both ways and keeps paging consistent', async () => {
    const asc = physical(await trees('sort=tree_id&order=asc'));
    expect(asc).toEqual([...asc].sort());
    expect(physical(await trees('sort=tree_id&order=desc'))).toEqual([...asc].reverse());
    const page1 = physical(await trees('sort=tree_id&order=desc&limit=2&offset=0'));
    const page2 = physical(await trees('sort=tree_id&order=desc&limit=2&offset=2'));
    expect([...page1, ...page2]).toEqual([...asc].reverse().slice(0, 4));
  });

  it('sorts the whole result on the server, not just the page', async () => {
    const newestYear = await trees('sort=planting_year&order=desc&limit=2');
    expect(newestYear.total).toBe(5);
    expect(newestYear.items.every((t: any) => t.year_label === '2025')).toBe(true);
    const oldestYear = await trees('sort=planting_year&order=asc&limit=3');
    expect(oldestYear.items.every((t: any) => t.year_label === '2024')).toBe(true);
  });

  it('sorts by area, species, status and last visit, combined with filters', async () => {
    const byArea = (await trees('sort=area&order=asc')).items.map((t: any) => `${t.sector_code}/${t.sub_sector_code}`);
    expect(byArea).toEqual(['S01/SS01', 'S01/SS01', 'S01/SS02', 'S02/SS1', 'S02/SS1']);
    const byAreaDesc = (await trees('sort=area&order=desc')).items.map((t: any) => t.sector_code);
    expect(byAreaDesc[0]).toBe('S02');
    expect((await trees('sort=species&order=asc')).total).toBe(5);
    expect((await trees('sort=status&order=desc')).items[0].status_code).toBe('DEAD');
    expect((await trees('sort=status&order=asc')).items[0].status_code).toBe('ALIVE');
    expect((await trees('sort=last_observed&order=desc')).items[0].id).toBe(ids.c);
    const filtered = await trees(`sector_id=${f.sectorId}&sort=last_observed&order=asc`);
    expect(filtered.total).toBe(3);
    expect(filtered.items[2].id).toBe(ids.c);
  });

  it('accepts only the listed columns and directions', async () => {
    await admin.get('/trees?sort=created_by').expect(400);
    await admin.get('/trees?sort=t.id;DROP TABLE trees').expect(400);
    await admin.get('/trees?sort=tree_id&order=sideways').expect(400);
  });
});

describe('audit log search', () => {
  const search = (query: string) => admin.get(`/audit-logs/search?${query}`).expect(200).then((r) => r.body);

  it('pages with a total, and filters by person, action, entity and date', async () => {
    const all = await search('limit=2');
    expect(all.items).toHaveLength(2);
    expect(all.total).toBeGreaterThan(5);
    const next = await search('limit=2&offset=2');
    expect(next.total).toBe(all.total);
    expect(next.items.map((l: any) => l.id)).not.toEqual(all.items.map((l: any) => l.id));

    const created = await search('action=tree.create');
    expect(created.total).toBe(5);
    expect(created.items.every((l: any) => l.action === 'tree.create')).toBe(true);
    const adminId = created.items[0].actor_id;
    expect((await search(`user_id=${adminId}&action=tree.create`)).total).toBe(5);
    expect((await search(`actor_id=${f.officerId}&action=tree.create`)).total).toBe(0);
    const sectors = await search('entity=sector');
    expect(sectors.items.every((l: any) => l.entity_type === 'sector')).toBe(true);
    expect(sectors.total).toBeGreaterThan(0);
    const today = new Date().toISOString().slice(0, 10);
    expect((await search(`from=${today}&to=${today}&action=tree.create`)).total).toBe(5);
    expect((await search('to=2000-01-01')).total).toBe(0);
  });

  it('searches the person, action, entity and details', async () => {
    const byTree = await search(`q=${encodeURIComponent(physical(await trees(`sector_id=${sector25}`))[0])}`);
    expect(byTree.items.some((l: any) => l.action === 'tree.create')).toBe(true);
    expect((await search('q=South')).items.some((l: any) => l.action === 'sector.create')).toBe(true);
    expect((await search('q=tree create')).total).toBeGreaterThanOrEqual(5);
    expect((await search('q=administrator')).total).toBeGreaterThan(0); // the seeded admin's name
    expect((await search('q=no-such-thing-anywhere')).total).toBe(0);
    // LIKE wildcards are matched literally.
    expect((await search('q=%25')).total).toBe(0);
  });

  it('sorts by time, person, action and entity, both ways', async () => {
    const newest = (await search('sort=time')).items.map((l: any) => Number(l.id));
    expect(newest).toEqual([...newest].sort((a, b) => b - a));
    const oldest = (await search('sort=time&order=asc&limit=3')).items.map((l: any) => Number(l.id));
    expect(oldest).toEqual([...oldest].sort((a, b) => a - b));
    const actions = (await search('sort=action&order=asc&limit=500')).items.map((l: any) => l.action);
    expect(actions).toEqual([...actions].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    const desc = (await search('sort=entity&order=desc&limit=500')).items.map((l: any) => l.entity_type);
    expect(desc).toEqual([...desc].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
    expect((await search('sort=user&limit=1')).items).toHaveLength(1);
    await admin.get('/audit-logs/search?sort=before').expect(400);
    await admin.get('/audit-logs/search?order=up').expect(400);
  });

  it('lists the entity types and actions, exports to Excel and keeps the original list', async () => {
    const facets = (await admin.get('/audit-logs/facets').expect(200)).body;
    expect(facets.entity_types).toEqual(expect.arrayContaining(['tree', 'sector']));
    expect(facets.actions).toEqual(expect.arrayContaining(['tree.create']));
    const xlsx = await admin.get('/audit-logs.xlsx?action=tree.create&sort=user').expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const legacy = (await admin.get('/audit-logs?action=tree.create&limit=2').expect(200)).body;
    expect(Array.isArray(legacy)).toBe(true);
    expect(legacy).toHaveLength(2);
    const older = (await admin.get(`/audit-logs?action=tree.create&before_id=${legacy[1].id}`).expect(200)).body;
    expect(older).toHaveLength(3);
  });
});

describe('Excel exports', () => {
  it('exports visits and field activity as workbooks', async () => {
    const visits = await admin.get(`/reports/visits.xlsx?sector_id=${f.sectorId}`).expect(200);
    expect(visits.headers['content-type']).toContain('spreadsheetml');
    expect(visits.headers['content-disposition']).toMatch(/visits-.*\.xlsx/);
    const activity = await admin.get('/reports/field-activity.xlsx?tz=UTC').expect(200);
    expect(activity.headers['content-type']).toContain('spreadsheetml');
    // The CSV endpoints stay for scripts.
    await admin.get('/reports/visits.csv').expect(200);
    await admin.get('/reports/field-activity.csv').expect(200);
  });
});
