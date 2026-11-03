import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { bootApp, resetDatabase, Session, sql } from './harness';
import { createOp, Fixtures, loadFixtures, observationOp, treePayload } from './fixtures';

// Visit types (monitoring or maintenance) and maintenance due dates: the project's interval after the latest
// maintenance visit, else the planting date, else the registration date.
let app: INestApplication;
let f: Fixtures;
let admin: Session;
let officer: Session;
const ids: Record<string, string> = {};
const visits: Record<string, string> = {};

/** YYYY-MM-DD, [n] days from today (UTC). */
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const at = (n: number) => `${day(n)}T09:00:00Z`;
const sync = (operations: unknown[]) => admin.post('/sync/batches', { device_id: admin.deviceId, operations }).expect(200);
const accept = async (operations: unknown[]) => {
  const res = await sync(operations);
  expect(res.body.results.map((r: any) => r.status)).toEqual(operations.map(() => 'ACCEPTED'));
};
const maintenanceOf = async (key: string) => (await admin.get(`/trees/${ids[key]}`).expect(200)).body.maintenance;
const listIds = async (query: string) => (await admin.get(`/trees?${query}`).expect(200)).body.items.map((t: any) => t.id);
const setInterval = (days: number) => admin.patch(`/projects/${f.projectId}`, { maintenance_interval_days: days });

beforeAll(async () => {
  await resetDatabase();
  app = await bootApp();
  f = await loadFixtures();
  admin = await new Session(app, 'admin@tms.local').login();
  officer = await new Session(app, 'officer@tms.local').login();
  // Planted 100, 80, 10 and 100 days ago (the last one is found dead), and one without a planting date.
  const planted = { overdue: -100, soon: -80, later: -10, dead: -100, unplanted: -95 };
  const payloads = Object.entries(planted).map(([key, n], i) => {
    const p = treePayload(f, String(500 + i), { planted_on: day(n), initial_observation: { id: randomUUID(), status_id: f.status.ALIVE, observed_at: at(n) } });
    ids[key] = p.id;
    return createOp(p);
  });
  await accept(payloads);
  await accept([observationOp(ids.dead, f.status.DEAD, { observed_at: at(-1) })]);
  // Registered 95 days ago without a planting date.
  await sql(`UPDATE trees SET planted_on = NULL, created_at = now() - interval '95 days' WHERE id = $1`, [ids.unplanted]);
});

afterAll(async () => {
  await app.close();
});

describe('maintenance interval', () => {
  it('is 90 days unless changed, between 7 and 730, and reaches the phones', async () => {
    expect((await admin.get(`/projects/${f.projectId}`).expect(200)).body.maintenance_interval_days).toBe(90);
    const boot = (await officer.get('/mobile/bootstrap').expect(200)).body;
    expect(boot.projects.find((p: any) => p.id === f.projectId).maintenance_interval_days).toBe(90);
    await setInterval(6).expect(400);
    await setInterval(731).expect(400);
    await setInterval(7.5).expect(400);
    expect((await setInterval(60).expect(200)).body.maintenance_interval_days).toBe(60);
    const changes = (await officer.get(`/sync/changes?cursor=${boot.cursor}`).expect(200)).body.changes;
    expect(changes.find((c: any) => c.entity_type === 'project').data.maintenance_interval_days).toBe(60);
    expect((await admin.get('/projects').expect(200)).body.find((p: any) => p.id === f.projectId).maintenance_interval_days).toBe(60);
    await setInterval(90).expect(200);
    const created = (await admin.post('/projects', { name: 'Quarterly', short_code: 'QTR', physical_id_uniqueness: 'PROJECT', maintenance_interval_days: 120 }).expect(201)).body;
    expect(created.maintenance_interval_days).toBe(120);
    expect((await admin.post('/projects', { name: 'Default', short_code: 'DFT', physical_id_uniqueness: 'PROJECT' }).expect(201)).body.maintenance_interval_days).toBe(90);
  });
});

describe('maintenance due dates', () => {
  it('counts from the planting date, else the registration date', async () => {
    expect(await maintenanceOf('overdue')).toEqual({ last_at: null, proposed_on: day(-10), status: 'overdue' });
    expect(await maintenanceOf('soon')).toEqual({ last_at: null, proposed_on: day(10), status: 'due_soon' });
    expect(await maintenanceOf('later')).toEqual({ last_at: null, proposed_on: day(80), status: 'scheduled' });
    expect(await maintenanceOf('unplanted')).toMatchObject({ proposed_on: day(-5), status: 'overdue' });
  });

  it('has no status for dead trees', async () => {
    expect(await maintenanceOf('dead')).toMatchObject({ status: 'none' });
  });

  it('counts from the latest maintenance visit, which clears the alert', async () => {
    const visit = observationOp(ids.overdue, f.status.ALIVE, { observed_at: at(-5), visit_type: 'MAINTENANCE' });
    await accept([visit]);
    visits.maintenance = visit.entity_id;
    expect(await maintenanceOf('overdue')).toEqual({ last_at: new Date(at(-5)).toISOString(), proposed_on: day(85), status: 'scheduled' });
    // An ordinary (monitoring) visit does not count as maintenance.
    await accept([observationOp(ids.soon, f.status.ALIVE, { observed_at: at(-1) })]);
    expect(await maintenanceOf('soon')).toMatchObject({ last_at: null, status: 'due_soon' });
  });

  it('ignores a maintenance visit that a correction replaced', async () => {
    const visit = observationOp(ids.soon, f.status.ALIVE, { observed_at: at(-2), visit_type: 'MAINTENANCE' });
    await accept([visit]);
    expect(await maintenanceOf('soon')).toMatchObject({ proposed_on: day(88), status: 'scheduled' });
    await accept([observationOp(ids.soon, f.status.ALIVE, { observed_at: at(-2), visit_type: 'VISIT', amends_observation_id: visit.entity_id, amendment_reason: 'Was a monitoring visit' })]);
    expect(await maintenanceOf('soon')).toEqual({ last_at: null, proposed_on: day(10), status: 'due_soon' });
  });

  it('follows a change of the project’s interval', async () => {
    await setInterval(7).expect(200);
    try {
      expect(await maintenanceOf('later')).toMatchObject({ proposed_on: day(-3), status: 'overdue' });
      expect(await maintenanceOf('overdue')).toMatchObject({ proposed_on: day(2), status: 'due_soon' });
    } finally {
      await setInterval(90).expect(200);
    }
    expect(await maintenanceOf('later')).toMatchObject({ proposed_on: day(80), status: 'scheduled' });
  });

  it('filters and sorts the tree list, and counts trees due on the dashboard', async () => {
    expect((await listIds('maintenance=overdue')).sort()).toEqual([ids.unplanted]);
    expect((await listIds('maintenance=due_soon')).sort()).toEqual([ids.soon]);
    expect((await admin.get('/trees?maintenance=due_soon').expect(200)).body.total).toBe(1);
    await admin.get('/trees?maintenance=soonish').expect(400);
    const sorted = (await admin.get('/trees?sort=maintenance&order=asc').expect(200)).body.items;
    expect(sorted.map((t: any) => t.id).slice(0, 2)).toEqual([ids.dead, ids.unplanted]);
    expect(sorted.every((t: any, i: number) => i === 0 || sorted[i - 1].maintenance.proposed_on <= t.maintenance.proposed_on)).toBe(true);
    const summary = (await admin.get(`/reports/summary?project_id=${f.projectId}`).expect(200)).body;
    expect(summary.maintenance).toEqual({ overdue_trees: 1, due_soon_trees: 1, due_soon_days: 14 });
    // Exports carry the dates too.
    const csv = (await admin.get('/reports/trees.csv').expect(200)).text;
    expect(csv.split('\n')[0]).toContain('last_maintenance_at,next_maintenance_on,maintenance_status');
  });
});

describe('visit types', () => {
  it('records maintenance visits and shows the type wherever visits are listed', async () => {
    const tree = (await admin.get(`/trees/${ids.overdue}`).expect(200)).body;
    expect(tree.observations.map((o: any) => o.visit_type)).toEqual(['MAINTENANCE', 'VISIT']);
    const rows = (await admin.get(`/reports/visits?visit_type=MAINTENANCE`).expect(200)).body.items;
    expect(rows).toHaveLength(2); // and the corrected one
    expect(rows.map((r: any) => r.id)).toContain(visits.maintenance);
    expect(rows.every((r: any) => r.visit_type === 'MAINTENANCE')).toBe(true);
    const days = (await admin.get(`/reports/visit-days?visit_type=MAINTENANCE&tz=UTC`).expect(200)).body;
    expect(days.items.reduce((n: number, d: any) => n + d.records, 0)).toBe(2);
    const records = (await admin.get(`/reports/visit-days/${day(-5)}/records?project_id=${f.projectId}&tz=UTC`).expect(200)).body.items;
    expect(records.find((r: any) => r.id === visits.maintenance).visit_type).toBe('MAINTENANCE');
    const link = (await admin.post(`/projects/${f.projectId}/share-links`, {}).expect(201)).body;
    const shared = (await request(app.getHttpServer()).get(`/api/v1/share/${link.token}/trees/${ids.overdue}`).expect(200)).body;
    expect(shared.observations.map((o: any) => o.visit_type)).toEqual(['MAINTENANCE', 'VISIT']);
    await admin.get('/reports/visits?visit_type=REPAIR').expect(400);
  });

  it('treats a visit without a type as monitoring (VISIT)', async () => {
    const visit = observationOp(ids.later, f.status.ALIVE, { observed_at: at(-1), visit_type: null });
    await accept([visit]);
    expect((await sql('SELECT visit_type FROM tree_observations WHERE id = $1', [visit.entity_id]))[0].visit_type).toBe('VISIT');
  });
});
