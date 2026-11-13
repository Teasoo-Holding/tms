// The harness first: it points the app's config at the test database before config is loaded.
import { bootApp, resetDatabase, Session, sql } from './harness';
import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Fixtures, loadFixtures } from './fixtures';
import { readKml } from '../../src/admin/kml';

let app: INestApplication;
let f: Fixtures;
let admin: Session;
const kml = readFileSync(join(__dirname, '../fixtures/2025_B_and_C.kml'), 'utf8');
beforeAll(async () => {
  await resetDatabase();
  app = await bootApp();
  f = await loadFixtures();
  admin = await new Session(app, 'admin@tms.local').login();
});
afterAll(async () => {
  await app.close();
});

describe('KML upload of sectors and sub-sectors', () => {
  it('reads sector, sub-sector and rally point names in common forms', () => {
    const r = readKml(`<kml><Document>
      <Placemark><name>S3/SS2</name><Polygon><outerBoundaryIs><LinearRing><coordinates>5.9,6.6 5.91,6.6 5.91,6.61 5.9,6.61</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
      <Placemark><name>Sector 03</name><Polygon><outerBoundaryIs><LinearRing><coordinates>5.9,6.6 5.91,6.6 5.91,6.61 5.9,6.6</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
      <Placemark><name>Rally point – camp</name><Point><coordinates>5.905,6.605,0</coordinates></Point></Placemark>
      <Placemark><name>Old well</name><Point><coordinates>5.9,6.6</coordinates></Point></Placemark>
      <Placemark><name>Road</name><Polygon><outerBoundaryIs><LinearRing><coordinates>5.9,6.6 5.91,6.6 5.91,6.61 5.9,6.6</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
    </Document></kml>`);
    expect(r.areas.map((a) => [a.kind, a.sector, a.sub])).toEqual([['sub_sector', 3, 2], ['sector', 3, undefined]]);
    expect(r.areas[0].ring).toHaveLength(5); // closed
    expect(r.rallyPoints).toEqual([{ name: 'Rally point – camp', latitude: 6.605, longitude: 5.905 }]);
    expect(r.skipped.map((s) => s.name)).toEqual(['Old well', 'Road']);
  });

  it('previews first, then creates and updates areas in place without deleting anything', async () => {
    // An existing sector of the year, with a sub-sector the file does not mention.
    const [s19] = await sql(`INSERT INTO sectors (project_id, planting_year_id, name, short_code) VALUES ($1, $2, 'Sector 19', 'S19') RETURNING id`, [f.projectId, f.year2025]);
    await sql(`INSERT INTO sub_sectors (sector_id, project_id, name, short_code) VALUES ($1, $2, 'Old', 'SS99')`, [s19.id, f.projectId]);

    const preview = (await admin.post(`/planting-years/${f.year2025}/areas/kml`, { kml }).expect(200)).body;
    expect(preview.applied).toBe(false);
    expect(preview.summary).toMatchObject({ sectors_created: 7, sectors_updated: 1, sub_sectors_created: 74, sub_sectors_updated: 0 });
    expect((await sql(`SELECT count(*)::int AS n FROM sectors WHERE planting_year_id = $1`, [f.year2025]))[0].n).toBe(1);

    const done = (await admin.post(`/planting-years/${f.year2025}/areas/kml`, { kml, apply: true }).expect(200)).body;
    expect(done.applied).toBe(true);
    const [c] = await sql(
      `SELECT (SELECT count(*)::int FROM sectors WHERE planting_year_id = $1 AND boundary_geometry IS NOT NULL) AS sectors,
              (SELECT count(*)::int FROM sub_sectors ss JOIN sectors s ON s.id = ss.sector_id WHERE s.planting_year_id = $1) AS subs`,
      [f.year2025],
    );
    expect(c).toEqual({ sectors: 8, subs: 75 }); // 74 from the file + the old SS99, kept
    const [ha] = await sql(`SELECT round((ST_Area(boundary_geometry::geography) / 10000)::numeric)::int AS ha FROM sectors WHERE id = $1`, [s19.id]);
    expect(ha.ha).toBe(10);
    // Uploading again updates the same areas.
    const again = (await admin.post(`/planting-years/${f.year2025}/areas/kml`, { kml, apply: true }).expect(200)).body;
    expect(again.summary).toMatchObject({ sectors_created: 0, sectors_updated: 8, sub_sectors_created: 0, sub_sectors_updated: 74 });
    expect((await sql(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'areas.import_kml'`))[0].n).toBe(2);
  });

  it('adds rally points to the project, and refuses files without outlines', async () => {
    const point = `<kml><Placemark><name>Rally point</name><Point><coordinates>5.9,6.62</coordinates></Point></Placemark></kml>`;
    await admin.post(`/planting-years/${f.year2025}/areas/kml`, { kml: point, apply: true }).expect(200);
    expect((await sql('SELECT rally_points FROM projects WHERE id = $1', [f.projectId]))[0].rally_points).toEqual([{ name: 'Rally point', latitude: 6.62, longitude: 5.9 }]);
    const earth = `<kml><Document><GroundOverlay><name>Layer</name></GroundOverlay></Document></kml>`;
    expect((await admin.post(`/planting-years/${f.year2025}/areas/kml`, { kml: earth }).expect(400)).body.code).toBe('KML_EMPTY');
    const officer = await new Session(app, 'officer@tms.local').login();
    await officer.post(`/planting-years/${f.year2025}/areas/kml`, { kml: point }).expect(403);
    // Rally points can also be set on the project, and reach phones with it.
    await admin.patch(`/projects/${f.projectId}`, { rally_points: [{ name: 'Camp', latitude: 6.61, longitude: 5.9 }] }).expect(200);
    const boot = (await officer.get('/mobile/bootstrap').expect(200)).body;
    expect(boot.projects.find((p: any) => p.id === f.projectId).rally_points).toEqual([{ name: 'Camp', latitude: 6.61, longitude: 5.9 }]);
  });
});
