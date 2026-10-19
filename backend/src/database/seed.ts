import { Client } from 'pg';
import { config } from '../config';
import { hashPassword } from '../auth/passwords';

/**
 * Development/demo seed data. Refuses to run in production. Idempotent: does nothing if the
 * demo administrator already exists. Status definitions are the PRD's suggested set and must
 * be confirmed by project stakeholders before go-live.
 */
export async function seed(databaseUrl = config.migrationDatabaseUrl, log = console.log) {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production.');
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const exists = await db.query(`SELECT 1 FROM users WHERE email = 'admin@tms.local'`);
    if (exists.rowCount) {
      log('Seed data already present.');
      return;
    }
    await db.query('BEGIN');
    const password = process.env.SEED_PASSWORD ?? 'ChangeMe!2026';
    const hash = await hashPassword(password);
    const user = async (email: string, name: string, role: string) =>
      (await db.query(`INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`, [email, name, role, hash])).rows[0].id;
    const admin = await user('admin@tms.local', 'Ada Administrator', 'ADMIN');
    const officer = await user('officer@tms.local', 'Femi Field Officer', 'FIELD_OFFICER');
    const officer2 = await user('officer2@tms.local', 'Grace Field Officer', 'FIELD_OFFICER');
    const exec = await user('exec@tms.local', 'Eli Executive', 'EXECUTIVE');

    const statuses = [
      ['PLANTED', 'Planted', false, false, 10],
      ['HEALTHY', 'Healthy', false, false, 20],
      ['NEEDS_INSPECTION', 'Needs inspection', false, false, 30],
      ['DAMAGED', 'Damaged', false, false, 40],
      ['DEAD', 'Dead', true, true, 50],
      ['MISSING', 'Missing', true, true, 60],
    ];
    for (const [code, name, terminal, replaceable, order] of statuses) {
      await db.query(
        `INSERT INTO tree_statuses (code, name, is_terminal, allows_replacement, requires_photo, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`,
        [code, name, terminal, replaceable, code === 'DEAD' || code === 'DAMAGED', order],
      );
    }
    for (const [sci, common, code] of [
      ['Khaya senegalensis', 'African mahogany', 'KS'],
      ['Milicia excelsa', 'Iroko', 'ME'],
      ['Terminalia superba', 'Afara', 'TS'],
      ['Azadirachta indica', 'Neem', 'AI'],
    ]) {
      await db.query(`INSERT INTO tree_species (scientific_name, common_name, code) VALUES ($1, $2, $3)`, [sci, common, code]);
    }
    await db.query(`INSERT INTO vendors (name, short_code, contact_name, location) VALUES ('Green Seedlings Ltd', 'V03', 'Kemi Ade', 'Ibadan')`);

    const project = (
      await db.query(
        `INSERT INTO projects (name, short_code, description, location, start_date, status, physical_id_uniqueness)
         VALUES ('Trees for Life', 'T4L', 'Demonstration reforestation project', 'Oyo State', '2024-01-01', 'ACTIVE', 'PROJECT') RETURNING id`,
      )
    ).rows[0].id;
    for (const year of ['2024', '2025', '2026']) {
      await db.query(`INSERT INTO planting_years (project_id, year_label, start_date, end_date) VALUES ($1, $2, $3, $4)`, [project, year, `${year}-01-01`, `${year}-12-31`]);
    }
    await db.query(
      `INSERT INTO tree_id_schemes (project_id, version, component_definition, separator, serial_width, serial_uniqueness_scope, created_by)
       VALUES ($1, 1, $2, '-', 6, $3, $4)`,
      [
        project,
        JSON.stringify([{ type: 'PROJECT_CODE', required: true }, { type: 'PLANTING_YEAR', required: true }, { type: 'SERIAL', required: true }]),
        JSON.stringify(['PROJECT', 'PLANTING_YEAR']),
        admin,
      ],
    );
    const poly = (lon: number, lat: number, d: number) =>
      JSON.stringify({ type: 'Polygon', coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] });
    const sector = (
      await db.query(
        `INSERT INTO sectors (project_id, name, short_code, reference_latitude, reference_longitude, boundary_geometry)
         VALUES ($1, 'North Ridge', 'S01', 7.405, 3.905, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)) RETURNING id`,
        [project, poly(3.9, 7.4, 0.01)],
      )
    ).rows[0].id;
    const subA = (
      await db.query(
        `INSERT INTO sub_sectors (sector_id, project_id, name, short_code, reference_latitude, reference_longitude, boundary_geometry)
         VALUES ($1, $2, 'Ridge East', 'SS01', 7.4025, 3.9025, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)) RETURNING id`,
        [sector, project, poly(3.9, 7.4, 0.005)],
      )
    ).rows[0].id;
    await db.query(
      `INSERT INTO sub_sectors (sector_id, project_id, name, short_code, reference_latitude, reference_longitude, boundary_geometry)
       VALUES ($1, $2, 'Ridge West', 'SS02', 7.4075, 3.9075, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))`,
      [sector, project, poly(3.905, 7.405, 0.005)],
    );
    await db.query(`INSERT INTO user_project_assignments (user_id, project_id) VALUES ($1, $2), ($3, $2)`, [officer, project, exec]);
    await db.query(`INSERT INTO user_project_assignments (user_id, project_id, sector_id, sub_sector_id) VALUES ($1, $2, $3, $4)`, [officer2, project, sector, subA]);
    await db.query('COMMIT');
    log(`Seeded demo data. Users admin@, officer@, officer2@, exec@tms.local share the password from SEED_PASSWORD (default ${password}).`);
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  seed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
