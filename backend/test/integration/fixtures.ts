import { randomUUID } from 'crypto';
import { sql } from './harness';

export interface Fixtures {
  projectId: string;
  year2024: string;
  year2025: string;
  schemeId: string;
  sectorId: string;
  subA: string;
  subB: string;
  speciesId: string;
  status: Record<string, string>;
  officerId: string;
}

export async function loadFixtures(): Promise<Fixtures> {
  const [project] = await sql(`SELECT id FROM projects WHERE short_code = 'T4L'`);
  const years = await sql(`SELECT id, year_label FROM planting_years WHERE project_id = $1`, [project.id]);
  const [scheme] = await sql(`SELECT id FROM tree_id_schemes WHERE project_id = $1 AND active`, [project.id]);
  const [sector] = await sql(`SELECT id FROM sectors WHERE short_code = 'S01'`);
  const subs = await sql(`SELECT id, short_code FROM sub_sectors ORDER BY short_code`);
  const [species] = await sql(`SELECT id FROM tree_species ORDER BY scientific_name LIMIT 1`);
  const statuses = await sql(`SELECT id, code FROM tree_statuses`);
  const [officer] = await sql(`SELECT id FROM users WHERE email = 'officer@tms.local'`);
  return {
    projectId: project.id,
    year2024: years.find((y) => y.year_label === '2024').id,
    year2025: years.find((y) => y.year_label === '2025').id,
    schemeId: scheme.id,
    sectorId: sector.id,
    subA: subs[0].id,
    subB: subs[1].id,
    speciesId: species.id,
    status: Object.fromEntries(statuses.map((s) => [s.code, s.id])),
    officerId: officer.id,
  };
}

export function treePayload(f: Fixtures, serial: string, overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    project_id: f.projectId,
    planting_year_id: f.year2024,
    sector_id: f.sectorId,
    sub_sector_id: f.subA,
    species_id: f.speciesId,
    id_scheme_id: f.schemeId,
    serial_input: serial,
    id_component_values: { PROJECT_CODE: 'T4L', PLANTING_YEAR: '2024' },
    planted_on: '2024-06-01',
    initial_observation: { id: randomUUID(), status_id: f.status.PLANTED, observed_at: '2024-06-01T09:00:00Z', remarks: null },
    ...overrides,
  };
}

export function createOp(payload: any) {
  return {
    operation_id: randomUUID(),
    entity_type: 'tree',
    entity_id: payload.id,
    operation_type: 'create',
    client_recorded_at: new Date().toISOString(),
    payload,
  };
}

export function observationOp(treeId: string, statusId: string, extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  return {
    operation_id: randomUUID(),
    entity_type: 'observation',
    entity_id: id,
    operation_type: extra.amends_observation_id ? 'amendment' : 'observation',
    client_recorded_at: new Date().toISOString(),
    payload: { id, tree_id: treeId, observed_status_id: statusId, observed_at: new Date().toISOString(), ...extra },
  };
}
