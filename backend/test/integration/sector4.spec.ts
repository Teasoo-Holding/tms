// The harness first: it points the app's config at the test database before config is loaded.
import { bootApp, resetDatabase, Session, sql } from './harness';
import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createOp, Fixtures, loadFixtures, treePayload } from './fixtures';

let app: INestApplication;
let f: Fixtures;
const migration = readFileSync(join(__dirname, '../../migrations/019_sector4_2026_sub_sectors.sql'), 'utf8');

beforeAll(async () => {
  await resetDatabase();
  app = await bootApp();
  f = await loadFixtures();
});
afterAll(async () => {
  await app.close();
});

describe('migration 019: Sector 4 (2026) sub-sectors', () => {
  it('recreates SS1–SS5 without GPS, keeps their trees, and shares misplaced trees out in blocks', async () => {
    const officer = await new Session(app, 'officer@tms.local').login();
    const square = `ST_GeomFromText('POLYGON((5.9 6.6,5.91 6.6,5.91 6.61,5.9 6.61,5.9 6.6))', 4326)`;
    const [year] = await sql(`INSERT INTO planting_years (project_id, year_label) VALUES ($1, '2026') ON CONFLICT (project_id, year_label) DO UPDATE SET year_label = EXCLUDED.year_label RETURNING id`, [f.projectId]);
    const [s4] = await sql(`INSERT INTO sectors (project_id, planting_year_id, name, short_code, boundary_geometry) VALUES ($1, $2, 'Sector 4', 'S4', ${square}) RETURNING id`, [f.projectId, year.id]);
    const sub: Record<string, string> = {};
    for (const code of ['SS1', 'SS2', 'SS3', 'SS4', 'SS5', 'SB5']) {
      const [r] = await sql(
        `INSERT INTO sub_sectors (sector_id, project_id, name, short_code, reference_latitude, reference_longitude, boundary_geometry) VALUES ($1, $2, $3, $3, 6.605, 5.905, ${square}) RETURNING id`,
        [s4.id, f.projectId, code],
      );
      sub[code] = r.id;
    }
    const ids: string[] = [];
    for (let i = 1; i <= 12; i++) {
      const p = treePayload(f, String(400 + i));
      ids.push(p.id);
      await officer.post('/sync/batches', { device_id: officer.deviceId, operations: [createOp(p)] }).expect(200);
    }
    // Two trees properly in SS2, ten in SB5 (serials 403-412).
    await sql(`UPDATE trees SET planting_year_id = $1, sector_id = $2, sub_sector_id = $3 WHERE id = ANY($4)`, [year.id, s4.id, sub.SS2, ids.slice(0, 2)]);
    await sql(`UPDATE trees SET planting_year_id = $1, sector_id = $2, sub_sector_id = $3 WHERE id = ANY($4)`, [year.id, s4.id, sub.SB5, ids.slice(2)]);
    const before = (await sql(`SELECT max(seq) AS seq FROM change_log`))[0].seq;

    await sql(migration);

    const subs = await sql(`SELECT short_code, name, boundary_geometry IS NULL AS no_outline, reference_latitude IS NULL AS no_point FROM sub_sectors WHERE sector_id = $1 ORDER BY short_code`, [s4.id]);
    expect(subs).toEqual([1, 2, 3, 4, 5].map((n) => ({ short_code: `SS${n}`, name: `Sub-sector ${n}`, no_outline: true, no_point: true })));
    const where = await sql(
      `SELECT t.serial_number, ss.short_code, t.revision FROM trees t JOIN sub_sectors ss ON ss.id = t.sub_sector_id WHERE t.id = ANY($1) ORDER BY t.serial_number`,
      [ids],
    );
    expect(where.map((r) => [r.serial_number, r.short_code])).toEqual([
      ['000401', 'SS2'], ['000402', 'SS2'],
      ['000403', 'SS1'], ['000404', 'SS1'], ['000405', 'SS2'], ['000406', 'SS2'], ['000407', 'SS3'], ['000408', 'SS3'],
      ['000409', 'SS4'], ['000410', 'SS4'], ['000411', 'SS5'], ['000412', 'SS5'],
    ]);
    // Moved trees get a new revision; phones receive the trees and the sub-sector changes.
    expect(where.filter((r) => r.revision > 1).length).toBe(10);
    const changes = await sql(`SELECT entity_type, count(*)::int AS n FROM change_log WHERE seq > $1 GROUP BY entity_type ORDER BY entity_type`, [before]);
    expect(changes).toEqual(expect.arrayContaining([{ entity_type: 'tree', n: 10 }, expect.objectContaining({ entity_type: 'sub_sector' })]));
    expect((await sql(`SELECT metadata FROM audit_logs WHERE action = 'migration.sector4_sub_sectors'`))[0].metadata).toMatchObject({ trees_moved: 10, sub_sectors_removed: 1 });

    // A second run changes nothing.
    const after = (await sql(`SELECT max(seq) AS seq FROM change_log`))[0].seq;
    await sql(migration);
    expect((await sql(`SELECT max(seq) AS seq FROM change_log`))[0].seq).toBe(after);
  });
});
