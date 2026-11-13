// The harness first: it points the app's config at the test database before config is loaded.
import { bootApp, resetDatabase, Session, sql } from './harness';
import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createOp, Fixtures, loadFixtures, treePayload } from './fixtures';

let app: INestApplication;
let f: Fixtures;
const migration = readFileSync(join(__dirname, '../../migrations/022_seplat_ehor_2025_areas.sql'), 'utf8');
beforeAll(async () => {
  await resetDatabase();
  app = await bootApp();
  f = await loadFixtures();
});
afterAll(async () => {
  await app.close();
});

describe('migration 022: 2025 sectors and sub-sectors', () => {
  it('loads 26 sectors and 239 sub-sectors with outlines, keeping where trees were recorded', async () => {
    const officer = await new Session(app, 'officer@tms.local').login();
    // An area created earlier without GPS, with a tree in it.
    const [s1] = await sql(`INSERT INTO sectors (project_id, planting_year_id, name, short_code) VALUES ($1, $2, 'Sector 1', 'S1') RETURNING id`, [f.projectId, f.year2025]);
    const [ss2] = await sql(`INSERT INTO sub_sectors (sector_id, project_id, name, short_code) VALUES ($1, $2, 'Sub-sector 2', 'SS2') RETURNING id`, [s1.id, f.projectId]);
    const [extra] = await sql(`INSERT INTO sub_sectors (sector_id, project_id, name, short_code) VALUES ($1, $2, 'Old', 'SS99') RETURNING id`, [s1.id, f.projectId]);
    const p = treePayload(f, '700');
    await officer.post('/sync/batches', { device_id: officer.deviceId, operations: [createOp(p)] }).expect(200);
    await sql(`UPDATE trees SET planting_year_id = $1, sector_id = $2, sub_sector_id = $3 WHERE id = $4`, [f.year2025, s1.id, ss2.id, p.id]);

    await sql(migration);

    const counts = (await sql(
      `SELECT (SELECT count(*)::int FROM sectors WHERE planting_year_id = $1 AND boundary_geometry IS NOT NULL) AS sectors,
              (SELECT count(*)::int FROM sub_sectors ss JOIN sectors s ON s.id = ss.sector_id WHERE s.planting_year_id = $1 AND ss.boundary_geometry IS NOT NULL) AS subs`,
      [f.year2025],
    ))[0];
    expect(counts).toEqual({ sectors: 26, subs: 239 });
    // The tree stays in S1/SS2, which now has an outline; the unused extra sub-sector is gone.
    const [t] = await sql(`SELECT sector_id, sub_sector_id FROM trees WHERE id = $1`, [p.id]);
    expect(t).toEqual({ sector_id: s1.id, sub_sector_id: ss2.id });
    expect((await sql(`SELECT boundary_geometry IS NOT NULL AS has FROM sub_sectors WHERE id = $1`, [ss2.id]))[0].has).toBe(true);
    expect(await sql(`SELECT id FROM sub_sectors WHERE id = $1`, [extra.id])).toEqual([]);
    const [s20] = await sql(`SELECT description FROM sectors WHERE planting_year_id = $1 AND short_code = 'S20'`, [f.year2025]);
    expect(s20.description).toMatch(/approximate GPS/);
    const [ha] = await sql(`SELECT round((ST_Area(boundary_geometry::geography) / 10000)::numeric, 1)::float8 AS ha FROM sectors WHERE planting_year_id = $1 AND short_code = 'S1'`, [f.year2025]);
    expect(ha.ha).toBeCloseTo(10.2, 0);
    // A second run changes nothing.
    const before = (await sql(`SELECT max(seq) AS seq FROM change_log`))[0].seq;
    await sql(migration);
    const after = (await sql(`SELECT count(*)::int AS n FROM sub_sectors ss JOIN sectors s ON s.id = ss.sector_id WHERE s.planting_year_id = $1`, [f.year2025]))[0].n;
    expect(after).toBe(239);
    expect(Number((await sql(`SELECT max(seq) AS seq FROM change_log`))[0].seq)).toBeGreaterThanOrEqual(Number(before));
  });
});
