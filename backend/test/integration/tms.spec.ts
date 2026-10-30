import { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import sharp from 'sharp';
import { bootApp, resetDatabase, Session, sql } from './harness';
import { createOp, Fixtures, loadFixtures, observationOp, treePayload } from './fixtures';

let app: INestApplication;
let f: Fixtures;
let admin: Session;
let officer: Session;
let officerB: Session; // second device of another officer
let scopedOfficer: Session; // officer2: assigned to sub-sector SS01 only
let exec: Session;

beforeAll(async () => {
  await resetDatabase();
  app = await bootApp();
  f = await loadFixtures();
  admin = await new Session(app, 'admin@tms.local').login();
  officer = await new Session(app, 'officer@tms.local').login();
  officerB = await new Session(app, 'officer@tms.local').login();
  scopedOfficer = await new Session(app, 'officer2@tms.local').login();
  exec = await new Session(app, 'exec@tms.local').login();
});

afterAll(async () => {
  await app.close();
});

const sync = (s: Session, operations: unknown[]) => s.post('/sync/batches', { device_id: s.deviceId, operations }).expect(200);

describe('offline registration and idempotent sync', () => {
  it('registers a tree from the serial alone and stores the scheme version and snapshot', async () => {
    const payload = treePayload(f, '1', { physical_tree_id: 'T4L-2024-000001' });
    const res = await sync(officer, [createOp(payload)]);
    const r = res.body.results[0];
    expect(r.status).toBe('ACCEPTED');
    expect(r.entity.physical_tree_id).toBe('T4L-2024-000001');
    expect(r.entity.id_scheme_version).toBe(1);
    expect(r.entity.id_components_snapshot.components.map((c: any) => c.value)).toEqual(['T4L', '2024', '000001']);
    expect(r.entity.current_status_id).toBe(f.status.ALIVE);
  });

  it('replaying the same batch does not create duplicate trees or observations', async () => {
    const op = createOp(treePayload(f, '2'));
    const first = await sync(officer, [op]);
    const again = await sync(officer, [op]);
    expect(first.body.results[0].status).toBe('ACCEPTED');
    expect(again.body.results[0].status).toBe('ALREADY_PROCESSED');
    expect(again.body.results[0].original_status).toBe('ACCEPTED');
    // A new operation for the same tree UUID (e.g. outbox rebuilt) is also safe.
    const rebuilt = await sync(officer, [{ ...op, operation_id: randomUUID() }]);
    expect(rebuilt.body.results[0].status).toBe('ALREADY_PROCESSED');
    const rows = await sql(`SELECT count(*)::int AS n FROM trees WHERE id = $1`, [op.entity_id]);
    const obs = await sql(`SELECT count(*)::int AS n FROM tree_observations WHERE tree_id = $1`, [op.entity_id]);
    expect(rows[0].n).toBe(1);
    expect(obs[0].n).toBe(1);
  });

  it('rejects an ID that does not match what the officer confirmed', async () => {
    const res = await sync(officer, [createOp(treePayload(f, '3', { physical_tree_id: 'T4L-2024-000999' }))]);
    expect(res.body.results[0]).toMatchObject({ status: 'REJECTED', code: 'ID_MISMATCH' });
  });

  it('does not require any tree-level GPS', async () => {
    const cols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = 'trees' AND column_name ~ '(lat|lon|gps|geom)'`);
    expect(cols).toEqual([]);
  });
});

describe('duplicate physical IDs across disconnected devices', () => {
  let conflictId: string;
  let incomingId: string;

  it('keeps the second submission as a conflict without overwriting the first', async () => {
    const a = treePayload(f, '50');
    const b = treePayload(f, '50');
    expect((await sync(officer, [createOp(a)])).body.results[0].status).toBe('ACCEPTED');
    const res = await sync(officerB, [createOp(b)]);
    const r = res.body.results[0];
    expect(r).toMatchObject({ status: 'CONFLICT', code: 'DUPLICATE_PHYSICAL_ID', existing_entity_id: a.id });
    conflictId = r.conflict_id;
    incomingId = b.id;
    const rows = await sql(`SELECT id, record_state FROM trees WHERE physical_tree_id = 'T4L-2024-000050' ORDER BY record_state`);
    expect(rows).toEqual([
      { id: a.id, record_state: 'ACTIVE' },
      { id: b.id, record_state: 'CONFLICT' },
    ]);
  });

  it('lets an administrator resolve it with an audited serial correction', async () => {
    const list = await admin.get('/conflicts').expect(200);
    expect(list.body.map((c: any) => c.id)).toContain(conflictId);
    await officer.post(`/conflicts/${conflictId}/resolve`, { resolution: 'REJECT_INCOMING', notes: 'nope' }).expect(403);
    const res = await admin
      .post(`/conflicts/${conflictId}/resolve`, { resolution: 'CORRECT_INCOMING_SERIAL', serial_input: '51', notes: 'Label was misread in the field' })
      .expect(201);
    expect(res.body.status).toBe('RESOLVED');
    const [tree] = await sql(`SELECT physical_tree_id, record_state FROM trees WHERE id = $1`, [incomingId]);
    expect(tree).toEqual({ physical_tree_id: 'T4L-2024-000051', record_state: 'ACTIVE' });
    const history = await sql(`SELECT previous_physical_id, new_physical_id FROM tree_physical_id_history WHERE tree_id = $1`, [incomingId]);
    expect(history).toEqual([{ previous_physical_id: 'T4L-2024-000050', new_physical_id: 'T4L-2024-000051' }]);
    const audit = await sql(`SELECT action FROM audit_logs WHERE entity_id IN ($1, $2) ORDER BY id`, [incomingId, conflictId]);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['tree.id_correction', 'conflict.resolve']));
  });
});

describe('observations', () => {
  let treeId: string;
  it('appends repeat visits and keeps history; amendments supersede without deleting', async () => {
    const p = treePayload(f, '100');
    treeId = p.id;
    await sync(officer, [createOp(p)]);
    const healthy = observationOp(treeId, f.status.ALIVE, { observed_at: '2024-09-01T10:00:00Z' });
    const damaged = observationOp(treeId, f.status.DEAD, { observed_at: '2025-01-15T10:00:00Z' });
    const res = await sync(officer, [healthy, damaged]);
    expect(res.body.results.map((r: any) => r.status)).toEqual(['ACCEPTED', 'ACCEPTED']);
    let [tree] = await sql(`SELECT current_status_id FROM trees WHERE id = $1`, [treeId]);
    expect(tree.current_status_id).toBe(f.status.DEAD);

    const amendment = observationOp(treeId, f.status.ALIVE, {
      observed_at: '2025-01-15T10:00:00Z',
      amends_observation_id: damaged.entity_id,
      amendment_reason: 'Wrong tree selected',
    });
    expect((await sync(officer, [amendment])).body.results[0].status).toBe('ACCEPTED');
    [tree] = await sql(`SELECT current_status_id FROM trees WHERE id = $1`, [treeId]);
    expect(tree.current_status_id).toBe(f.status.ALIVE);
    const detail = await officer.get(`/trees/${treeId}`).expect(200);
    expect(detail.body.observations).toHaveLength(4);
    expect(detail.body.observations.find((o: any) => o.id === damaged.entity_id).superseded).toBe(true);
  });

  it('rejects amendments by a different officer', async () => {
    const [obs] = await sql(`SELECT id FROM tree_observations WHERE tree_id = $1 AND is_initial`, [treeId]);
    const other = await new Session(app, 'officer2@tms.local').login();
    const res = await sync(other, [observationOp(treeId, f.status.ALIVE, { amends_observation_id: obs.id, amendment_reason: 'x' })]);
    expect(res.body.results[0]).toMatchObject({ status: 'REJECTED', code: 'AMENDMENT_NOT_ALLOWED' });
  });
});

describe('replacement planting and lineage', () => {
  it('requires a dead/missing status, gives a new ID and links to the original', async () => {
    const original = treePayload(f, '200');
    await sync(officer, [createOp(original)]);
    const premature = treePayload(f, '1', { planting_year_id: f.year2025, id_component_values: { PROJECT_CODE: 'T4L', PLANTING_YEAR: '2025' }, replaces_tree_id: original.id });
    expect((await sync(officer, [createOp(premature)])).body.results[0]).toMatchObject({ status: 'REJECTED', code: 'ORIGINAL_NOT_REPLACEABLE' });

    await sync(officer, [observationOp(original.id, f.status.DEAD)]);
    const replacement = treePayload(f, '1', { planting_year_id: f.year2025, id_component_values: { PROJECT_CODE: 'T4L', PLANTING_YEAR: '2025' }, replaces_tree_id: original.id });
    const res = await sync(officer, [createOp(replacement)]);
    expect(res.body.results[0].status).toBe('ACCEPTED');
    expect(res.body.results[0].entity).toMatchObject({ physical_tree_id: 'T4L-2025-000001', replaces_tree_id: original.id });

    const detail = await officer.get(`/trees/${replacement.id}`).expect(200);
    expect(detail.body.lineage.map((l: any) => [l.generation, l.physical_tree_id])).toEqual([
      [-1, 'T4L-2024-000200'],
      [0, 'T4L-2025-000001'],
    ]);
    // The original keeps its identity, observations and history.
    const orig = await officer.get(`/trees/${original.id}`).expect(200);
    expect(orig.body.physical_tree_id).toBe('T4L-2024-000200');
    expect(orig.body.observations).toHaveLength(2);

    // A second device replacing the same dead tree offline becomes a reviewable conflict.
    const dup = treePayload(f, '2', { planting_year_id: f.year2025, id_component_values: { PROJECT_CODE: 'T4L', PLANTING_YEAR: '2025' }, replaces_tree_id: original.id });
    expect((await sync(officerB, [createOp(dup)])).body.results[0]).toMatchObject({ status: 'CONFLICT', code: 'DUPLICATE_REPLACEMENT' });
  });

  it('reports original, replacement and planting events separately', async () => {
    const res = await exec.get(`/reports/summary?project_id=${f.projectId}`).expect(200);
    const t = res.body.totals;
    expect(t.replacement_trees).toBe(1);
    expect(t.planting_events).toBe(t.original_trees + t.replacement_trees);
    expect(res.body.last_server_sync_at).toBeTruthy();
    expect(res.body.notes[0]).toMatch(/not survival/);
  });
});

describe('concurrent metadata edits', () => {
  it('detects a stale base revision and keeps the edit for review', async () => {
    const p = treePayload(f, '300');
    await sync(officer, [createOp(p)]);
    const edit = (rev: number, notes: string) => ({
      operation_id: randomUUID(), entity_type: 'tree', entity_id: p.id, operation_type: 'update', base_revision: rev,
      client_recorded_at: new Date().toISOString(), payload: { id: p.id, changes: { notes } },
    });
    expect((await sync(officer, [edit(1, 'first')])).body.results[0].status).toBe('ACCEPTED');
    const stale = await sync(officerB, [edit(1, 'second')]);
    expect(stale.body.results[0]).toMatchObject({ status: 'CONFLICT', code: 'REVISION_MISMATCH' });
    const [tree] = await sql(`SELECT notes, revision FROM trees WHERE id = $1`, [p.id]);
    expect(tree).toEqual({ notes: 'first', revision: 2 });
  });
});

describe('media verification', () => {
  const bytes = Buffer.from('fake-jpeg-bytes-' + 'x'.repeat(500));
  const checksum = createHash('sha256').update(bytes).digest('hex');

  function uploadSession(treeId: string, observationId: string | null, size = bytes.length) {
    return officer
      .post('/media/upload-sessions', {
        media_id: randomUUID(), tree_id: treeId, observation_id: observationId, checksum_sha256: checksum,
        byte_size: size, mime_type: 'image/jpeg', captured_at: new Date().toISOString(),
      });
  }
  const put = (url: string, body: Buffer) => {
    const u = new URL(url);
    return request(app.getHttpServer()).put(u.pathname + u.search).set('Content-Type', 'image/jpeg').send(body);
  };

  it('confirms durable storage, checksum and association before the device may delete', async () => {
    const p = treePayload(f, '400');
    await sync(officer, [createOp(p)]);
    const session = await uploadSession(p.id, p.initial_observation.id).expect(201);
    const mediaId = session.body.media.id;
    // Not yet uploaded: not deletable.
    let done = await officer.post(`/media/${mediaId}/complete`).expect(200);
    expect(done.body).toMatchObject({ upload_state: 'FAILED', failure_reason: 'OBJECT_MISSING', safe_to_delete_local_copy: false });
    // Retry after an interrupted upload: re-request a URL, upload, verify.
    const retry = await officer.post('/media/upload-sessions', {
      media_id: mediaId, tree_id: p.id, observation_id: p.initial_observation.id, checksum_sha256: checksum,
      byte_size: bytes.length, mime_type: 'image/jpeg', captured_at: new Date().toISOString(),
    }).expect(201);
    await put(retry.body.upload_url, bytes).expect(200);
    done = await officer.post(`/media/${mediaId}/complete`).expect(200);
    expect(done.body).toMatchObject({ upload_state: 'VERIFIED', safe_to_delete_local_copy: true });
    expect(done.body.remote_verified_at).toBeTruthy();
    expect(done.body.association_verified_at).toBeTruthy();
  });

  it('flags corrupted uploads', async () => {
    const p = treePayload(f, '401');
    await sync(officer, [createOp(p)]);
    const session = await uploadSession(p.id, null).expect(201);
    await put(session.body.upload_url, Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from('Z')])).expect(200);
    const done = await officer.post(`/media/${session.body.media.id}/complete`).expect(200);
    expect(done.body).toMatchObject({ upload_state: 'FAILED', failure_reason: 'CHECKSUM_MISMATCH', safe_to_delete_local_copy: false });
  });

  it('refuses uploads for trees that are not synced yet', async () => {
    await uploadSession(randomUUID(), null).expect(409);
  });
});

describe('access control', () => {
  it('scoped officers cannot register in unassigned sub-sectors', async () => {
    const res = await sync(scopedOfficer, [createOp(treePayload(f, '500', { sub_sector_id: f.subB }))]);
    expect(res.body.results[0]).toMatchObject({ status: 'REJECTED', code: 'AREA_NOT_ASSIGNED' });
    const ok = await sync(scopedOfficer, [createOp(treePayload(f, '501'))]);
    expect(ok.body.results[0].status).toBe('ACCEPTED');
  });

  it('executives are read-only', async () => {
    await exec.post('/trees', treePayload(f, '600')).expect(403);
    await exec.post('/projects', { name: 'x', short_code: 'X', physical_id_uniqueness: 'PROJECT' }).expect(403);
    await exec.get('/reports/summary').expect(200);
  });

  it('users cannot read unassigned projects', async () => {
    const created = await admin.post('/projects', { name: 'Hidden', short_code: 'HID', physical_id_uniqueness: 'PROJECT', status: 'ACTIVE' }).expect(201);
    await officer.get(`/projects/${created.body.id}`).expect(403);
    const list = await officer.get('/projects').expect(200);
    expect(list.body.map((p: any) => p.id)).not.toContain(created.body.id);
    await officer.get(`/mobile/trees?project_id=${created.body.id}`).expect(403);
  });

  it('deactivated users lose access immediately and their refresh tokens stop working', async () => {
    const victim = await admin.post('/users', { email: 'temp@tms.local', full_name: 'Temp', role: 'FIELD_OFFICER', password: 'ChangeMe!2026' }).expect(201);
    const s = await new Session(app, 'temp@tms.local').login();
    await s.get('/auth/me').expect(200);
    await admin.patch(`/users/${victim.body.id}`, { active: false }).expect(200);
    await s.get('/auth/me').expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refresh_token: s.refresh }).expect(401);
  });

  it('detects refresh-token reuse', async () => {
    const s = await new Session(app, 'officer@tms.local').login();
    const first = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refresh_token: s.refresh }).expect(200);
    const second = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refresh_token: first.body.refresh_token }).expect(200);
    // The first token again, after its replacement was used (a lost-response retry is allowed only before that).
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refresh_token: s.refresh }).expect(401);
    // Reuse revokes the whole family, including the newest token.
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refresh_token: second.body.refresh_token }).expect(401);
  });
});

describe('ID scheme versioning and serial allocation', () => {
  it('new scheme versions apply to new registrations only', async () => {
    const res = await admin.post(`/projects/${f.projectId}/tree-id-schemes`, {
      components: [
        { type: 'PROJECT_CODE', required: true }, { type: 'PLANTING_YEAR', required: true },
        { type: 'SECTOR_CODE', required: true }, { type: 'SUB_SECTOR_CODE', required: true }, { type: 'SERIAL', required: true },
      ],
      separator: '-', serial_width: 5, serial_uniqueness_scope: ['SUB_SECTOR'],
    }).expect(201);
    expect(res.body.version).toBe(2);
    const p = treePayload(f, '7', { id_scheme_id: res.body.id, id_component_values: undefined });
    const r = (await sync(officer, [createOp(p)])).body.results[0];
    expect(r.entity.physical_tree_id).toBe('T4L-2024-S01-SS01-00007');
    const [old] = await sql(`SELECT physical_tree_id, id_scheme_version FROM trees WHERE serial_number = '000001' AND id_scheme_version = 1 LIMIT 1`);
    expect(old.physical_tree_id).toMatch(/^T4L-202[45]-000001$/);
  });

  it('enforces pre-allocated serial ranges', async () => {
    const scope = `PLANTING_YEAR=${f.year2025}|PROJECT=${f.projectId}`;
    // Scheme v1 is no longer active, but devices with a cached copy may still use it.
    const [v1] = await sql(`SELECT id FROM tree_id_schemes WHERE project_id = $1 AND version = 1`, [f.projectId]);
    await admin.post('/serial-allocations', { project_id: f.projectId, scope_key: scope, user_id: f.officerId, range_start: 1000, range_end: 1999 }).expect(201);
    await admin.post('/serial-allocations', { project_id: f.projectId, scope_key: scope, range_start: 1500, range_end: 2500 }).expect(400);
    const base = { planting_year_id: f.year2025, id_scheme_id: v1.id, id_component_values: { PROJECT_CODE: 'T4L', PLANTING_YEAR: '2025' } };
    expect((await sync(officer, [createOp(treePayload(f, '999', base))])).body.results[0].code).toBe('SERIAL_NOT_ALLOCATED');
    expect((await sync(officer, [createOp(treePayload(f, '1000', base))])).body.results[0].status).toBe('ACCEPTED');
  });
});

describe('change feed', () => {
  it('returns changes after a cursor, scoped to assigned areas', async () => {
    const boot = await scopedOfficer.get('/mobile/bootstrap').expect(200);
    expect(boot.body.sub_sectors.map((s: any) => s.id)).toEqual([f.subA]);
    const cursor = boot.body.cursor;
    const inA = treePayload(f, '700');
    const inB = treePayload(f, '701', { sub_sector_id: f.subB });
    await sync(officer, [createOp(inA), createOp(inB)]);
    const changes = await scopedOfficer.get(`/sync/changes?cursor=${cursor}`).expect(200);
    const treeIds = changes.body.changes.filter((c: any) => c.entity_type === 'tree').map((c: any) => c.data.id);
    expect(treeIds).toContain(inA.id);
    expect(treeIds).not.toContain(inB.id);
    const next = await scopedOfficer.get(`/sync/changes?cursor=${changes.body.next_cursor}`).expect(200);
    expect(next.body.changes).toEqual([]);
  });
});

describe('geography', () => {
  it('rejects invalid polygons and sub-sectors outside their sector', async () => {
    const bowtie = { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] };
    const bad = await admin.post(`/projects/${f.projectId}/sectors`, { planting_year_id: f.year2024, name: 'Bad', short_code: 'S99', reference_latitude: 0.5, reference_longitude: 0.5, boundary: bowtie }).expect(400);
    expect(bad.body.code).toBe('GEOMETRY_INVALID');
    const far = { type: 'Polygon', coordinates: [[[10, 10], [10.1, 10], [10.1, 10.1], [10, 10.1], [10, 10]]] };
    const outside = await admin.post(`/sectors/${f.sectorId}/sub-sectors`, { name: 'Far', short_code: 'SS99', reference_latitude: 10.05, reference_longitude: 10.05, boundary: far }).expect(400);
    expect(outside.body.code).toBe('GEOMETRY_OUTSIDE_PARENT');
    await admin.post(`/projects/${f.projectId}/sectors`, { name: 'Lat', short_code: 'S98', reference_latitude: 91, reference_longitude: 0 }).expect(400);
  });

  it('exports areas as GeoJSON', async () => {
    const res = await exec.get(`/projects/${f.projectId}/areas.geojson`).expect(200);
    expect(res.body.type).toBe('FeatureCollection');
    expect(res.body.features.filter((x: any) => x.properties.kind === 'sub_sector')).toHaveLength(2);
  });
});

describe('exports', () => {
  it('produces CSV with formula injection neutralised', async () => {
    const p = treePayload(f, '800', { notes: '=HYPERLINK("http://evil")' });
    await sync(officer, [createOp(p)]);
    const res = await admin.get(`/reports/trees.csv?project_id=${f.projectId}`).expect(200);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

describe('custom fields, tree height and attribution', () => {
  let batchField: any;

  it('administrators add project fields that devices receive with their configuration', async () => {
    const res = await admin
      .post(`/projects/${f.projectId}/custom-fields`, { applies_to: 'TREE', label: 'Nursery batch no.', field_type: 'TEXT', sticky: true })
      .expect(201);
    batchField = res.body;
    expect(batchField.key).toBe('nursery_batch_no');
    await admin.post(`/projects/${f.projectId}/custom-fields`, { applies_to: 'OBSERVATION', label: 'Pests', field_type: 'SELECT' }).expect(400);
    await admin
      .post(`/projects/${f.projectId}/custom-fields`, { applies_to: 'OBSERVATION', label: 'Pests', field_type: 'SELECT', options: ['None', 'Termites'] })
      .expect(201);
    await officer.post(`/projects/${f.projectId}/custom-fields`, { applies_to: 'TREE', label: 'X', field_type: 'TEXT' }).expect(403);
    const boot = await officer.get('/mobile/bootstrap').expect(200);
    expect(boot.body.custom_fields.map((d: any) => d.key).sort()).toEqual(['nursery_batch_no', 'pests']);
  });

  it('stores field values and height, and refuses fields the project does not have', async () => {
    const payload = treePayload(f, '7001', {
      custom_fields: { nursery_batch_no: 'B-17' },
      initial_observation: {
        id: randomUUID(), status_id: f.status.ALIVE, observed_at: '2024-06-01T09:00:00Z',
        height_cm: 42.25, height_method: 'PHOTO_REFERENCE', height_measurement: { reference_cm: 100, points: { ref_top: [0.4, 0.1] } },
        custom_fields: { pests: 'Termites' },
      },
    });
    const ok = await sync(officer, [createOp(payload)]);
    expect(ok.body.results[0].status).toBe('ACCEPTED');
    expect(ok.body.results[0].entity.custom_fields).toEqual({ nursery_batch_no: 'B-17' });
    const tree = await officer.get(`/trees/${payload.id}`).expect(200);
    expect(tree.body.custom_fields.nursery_batch_no).toBe('B-17');
    expect(tree.body.observations[0].height_cm).toBe(42.3);
    expect(tree.body.observations[0].height_method).toBe('PHOTO_REFERENCE');
    expect(tree.body.observations[0].custom_fields).toEqual({ pests: 'Termites' });

    const growth = await sync(officer, [observationOp(payload.id, f.status.ALIVE, { height_cm: 80 })]);
    expect(growth.body.results[0].status).toBe('ACCEPTED');
    expect(growth.body.results[0].entity.height_method).toBe('MANUAL');

    const unknown = await sync(officer, [createOp(treePayload(f, '7002', { custom_fields: { colour: 'red' } }))]);
    expect(unknown.body.results[0].status).toBe('REJECTED');
    expect(unknown.body.results[0].code).toBe('CUSTOM_FIELD_UNKNOWN');
  });

  it('a deactivated field keeps old values valid and leaves new forms', async () => {
    await admin.patch(`/custom-fields/${batchField.id}`, { active: false, label: 'Batch (old)' }).expect(200);
    const res = await sync(officer, [createOp(treePayload(f, '7003', { custom_fields: { nursery_batch_no: 'B-18' } }))]);
    expect(res.body.results[0].status).toBe('ACCEPTED');
    const fields = (await admin.get(`/projects/${f.projectId}/custom-fields`).expect(200)).body;
    expect(fields.find((d: any) => d.id === batchField.id).active).toBe(false);
  });

  it('records who entered every tree and observation in the audit log', async () => {
    const logs = (await admin.get(`/audit-logs?actor_id=${f.officerId}&action=tree.create`).expect(200)).body;
    const entry = logs.find((l: any) => l.entity_label === 'T4L-2024-007001');
    expect(entry).toBeDefined();
    expect(entry.actor_name).toBeTruthy();
    expect(entry.metadata.device_id).toBe(officer.deviceId);
    const obs = (await admin.get(`/audit-logs?action=observation.create`).expect(200)).body;
    expect(obs.some((l: any) => l.entity_label === 'T4L-2024-007001')).toBe(true);
    await officer.get('/audit-logs').expect(403);
    const users = (await admin.get('/users').expect(200)).body;
    expect(users.find((u: any) => u.id === f.officerId).trees_registered).toBeGreaterThan(0);
  });

  it('reports growth, weekly activity and status breakdowns', async () => {
    const s = (await exec.get(`/reports/summary?project_id=${f.projectId}`).expect(200)).body;
    expect(s.growth.some((g: any) => g.avg_height_cm > 0)).toBe(true);
    expect(s.activity_by_week).toHaveLength(12);
    expect(s.status_by_sector.length).toBeGreaterThan(0);
    expect(s.status_by_species.length).toBeGreaterThan(0);
  });
});

describe('spec alignment: statuses, sign-in identifiers, filters, visits', () => {
  it('uses the spec statuses, both needing a photo', async () => {
    const statuses = (await admin.get('/tree-statuses').expect(200)).body;
    const active = statuses.filter((s: any) => s.active).map((s: any) => [s.code, s.is_terminal, s.requires_photo]);
    expect(active).toEqual([['ALIVE', false, true], ['DEAD', true, true]]);
  });

  it('lets an administrator create users without an email and keeps identifiers unique', async () => {
    const created = await admin
      .post('/users', { username: 'kola.ade', phone: '0805-111-2222', full_name: 'Kola Ade', role: 'FIELD_OFFICER', password: 'Str0ng!Passw0rd' })
      .expect(201);
    expect(created.body).toMatchObject({ username: 'kola.ade', phone: '08051112222', email: null });
    await admin.post('/users', { full_name: 'No Login', role: 'FIELD_OFFICER', password: 'Str0ng!Passw0rd' }).expect(400);
    const dup = await admin.post('/users', { username: 'Kola.Ade', full_name: 'Twin', role: 'FIELD_OFFICER', password: 'Str0ng!Passw0rd' }).expect(400);
    expect(dup.body.code).toBe('USERNAME_TAKEN');
    const phoneDup = await admin.post('/users', { username: 'other1', phone: '+2348051112222', full_name: 'X', role: 'FIELD_OFFICER', password: 'Str0ng!Passw0rd' }).expect(400);
    expect(phoneDup.body.code).toBe('PHONE_TAKEN');
    await admin.post('/users', { username: '12345', full_name: 'Digits', role: 'FIELD_OFFICER', password: 'Str0ng!Passw0rd' }).expect(400);
  });

  it('filters the dashboard by area, species, status and date, and reports alive/dead per area', async () => {
    const all = (await admin.get(`/reports/summary?project_id=${f.projectId}`).expect(200)).body;
    const dead = (await admin.get(`/reports/summary?project_id=${f.projectId}&status_id=${f.status.DEAD}`).expect(200)).body;
    expect(Number(dead.totals.planting_events)).toBeGreaterThan(0);
    expect(Number(dead.totals.planting_events)).toBeLessThan(Number(all.totals.planting_events));
    const subB = (await admin.get(`/reports/summary?project_id=${f.projectId}&sub_sector_id=${f.subB}`).expect(200)).body;
    expect(Number(subB.totals.planting_events)).toBeLessThan(Number(all.totals.planting_events));
    const future = (await admin.get(`/reports/summary?project_id=${f.projectId}&from=2099-01-01`).expect(200)).body;
    expect(Number(future.totals.planting_events)).toBe(0);
    const area = all.area_coverage.find((a: any) => a.dead_trees > 0);
    expect(area.alive_trees + area.dead_trees + area.unknown_trees).toBe(area.registered_trees);
    expect(all.sector_share.reduce((n: number, s: any) => n + s.registered_trees, 0)).toBe(Number(all.totals.planting_events));
  });

  it('lists every visit newest first, filterable, with a CSV export', async () => {
    const page = (await exec.get(`/reports/visits?project_id=${f.projectId}&limit=5`).expect(200)).body;
    expect(page.items.length).toBe(5);
    expect(page.total).toBeGreaterThan(5);
    const times = page.items.map((v: any) => new Date(v.observed_at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const mine = (await admin.get(`/reports/visits?recorded_by=${f.officerId}&q=007001`).expect(200)).body;
    expect(mine.items.every((v: any) => v.recorded_by && v.physical_tree_id.includes('007001'))).toBe(true);
    const csv = await admin.get(`/reports/visits.csv?project_id=${f.projectId}`).expect(200);
    expect(csv.text.split('\n')[0]).toContain('observed_at,visit_type,physical_tree_id');
  });
});

describe('areas per planting year, vendors and their ID formats', () => {
  // A 2026 survey: a square sector near Ibadan and a sub-sector inside it.
  const sq = (lat: number, lon: number, d: number) => [
    { latitude: lat, longitude: lon }, { latitude: lat + d, longitude: lon + d }, // deliberately out of order
    { latitude: lat + d, longitude: lon }, { latitude: lat, longitude: lon + d },
  ];
  let year2026: string;
  let sector26: string;
  let sub26: string;
  let vendor: string;

  it('builds sector and sub-sector outlines from corner points within a planting year', async () => {
    year2026 = (await admin.post(`/projects/${f.projectId}/planting-years`, { year_label: '2030' }).expect(201)).body.id;
    const s = await admin.post(`/projects/${f.projectId}/sectors`, { planting_year_id: year2026, name: 'North 2026', short_code: 'S01', corners: sq(7.40, 3.90, 0.01) }).expect(201);
    sector26 = s.body.id;
    expect(s.body.planting_year_id).toBe(year2026);
    expect(s.body.boundary.coordinates[0]).toHaveLength(5);
    expect(s.body.reference_latitude).toBeGreaterThan(7.40);
    // Corners a few metres outside the sector (phone GPS error) are accepted; far outside is refused.
    const ok = await admin.post(`/sectors/${sector26}/sub-sectors`, { name: 'Edge', short_code: 'SS01', corners: sq(7.40 - 0.00005, 3.90, 0.004) }).expect(201);
    sub26 = ok.body.id;
    const far = await admin.post(`/sectors/${sector26}/sub-sectors`, { name: 'Far', short_code: 'SS02', corners: sq(7.50, 3.90, 0.004) }).expect(400);
    expect(far.body.code).toBe('GEOMETRY_OUTSIDE_PARENT');
    await admin.post(`/projects/${f.projectId}/sectors`, { planting_year_id: year2026, name: 'Dup', short_code: 'S01', corners: sq(7.5, 3.9, 0.01) }).expect(400);
    const areas = (await admin.get(`/projects/${f.projectId}/areas?planting_year_id=${year2026}`).expect(200)).body;
    expect(areas.some((a: any) => a.id === sector26)).toBe(true);
    expect(areas.every((a: any) => a.planting_year_id === year2026 || a.planting_year_id === null)).toBe(true);
  });

  it("refuses a tree placed in another year's area", async () => {
    const res = await sync(admin, [
      createOp(treePayload(f, '8801', { planting_year_id: f.year2024, sector_id: sector26, sub_sector_id: sub26 })),
    ]);
    expect(res.body.results[0].code).toBe('AREA_OTHER_YEAR');
  });

  it('links vendors to a planting year; one project format, which may number trees per vendor', async () => {
    vendor = (await admin.post('/vendors', { name: 'Konam Ltd', short_code: 'KNM' }).expect(201)).body.id;
    const other = (await admin.post('/vendors', { name: 'Green Hands', short_code: 'GRH' }).expect(201)).body.id;
    await admin.post(`/planting-years/${year2026}/vendors`, { vendor_id: vendor }).expect(201);
    await admin.post(`/planting-years/${year2026}/vendors`, { vendor_id: other }).expect(201);
    const boot = (await admin.get('/mobile/bootstrap').expect(200)).body;
    expect(boot.planting_year_vendors.some((l: any) => l.vendor_id === vendor && l.planting_year_id === year2026)).toBe(true);
    expect(boot.sectors.find((s: any) => s.id === sector26).planting_year_id).toBe(year2026);

    const format = { components: [{ type: 'PROJECT_CODE' }, { type: 'PLANTING_YEAR' }, { type: 'SECTOR_CODE' }, { type: 'SERIAL' }], separator: '-', serial_width: 5 };
    const scheme = (body: Record<string, unknown>) => admin.post(`/projects/${f.projectId}/tree-id-schemes`, { ...format, serial_uniqueness_scope: ['PROJECT', 'PLANTING_YEAR'], ...body });
    expect((await scheme({ vendor_id: vendor }).expect(400)).body.code).toBe('VENDOR_FORMAT_RETIRED');
    expect((await scheme({ planting_year_id: year2026 }).expect(400)).body.code).toBe('YEAR_FORMAT_RETIRED');
    await scheme({ components: [{ type: 'TEXT', value: 'bad text!' }, { type: 'SERIAL' }], serial_uniqueness_scope: [] }).expect(400);

    // The vendor code in the ID, numbered per project + planting year + vendor: each vendor starts from 1.
    const vendorFmt = await scheme({
      components: [{ type: 'PROJECT_CODE' }, { type: 'PLANTING_YEAR' }, { type: 'VENDOR_CODE' }, { type: 'SERIAL' }],
      serial_width: 6, serial_uniqueness_scope: ['PROJECT', 'PLANTING_YEAR', 'VENDOR'],
    }).expect(201);
    const project = (await admin.get(`/projects/${f.projectId}`).expect(200)).body;
    expect(project.tree_id_schemes.filter((s: any) => s.active).map((s: any) => s.id)).toEqual([vendorFmt.body.id]);
    const del = await admin.del(`/tree-id-schemes/${vendorFmt.body.id}`).expect(409);
    expect(del.body.code).toBe('FORMAT_CURRENT');

    const register = (serial: string, vendorId: string | null, schemeId: string, values: Record<string, string> = {}) =>
      sync(admin, [
        createOp(
          treePayload(f, serial, {
            planting_year_id: year2026, sector_id: sector26, sub_sector_id: sub26, vendor_id: vendorId, id_scheme_id: schemeId,
            id_component_values: { PROJECT_CODE: 'T4L', PLANTING_YEAR: '2030', ...values },
          }),
        ),
      ]).then((r) => r.body.results[0]);
    const knm = await register('1', vendor, vendorFmt.body.id);
    expect(knm.status).toBe('ACCEPTED');
    expect(knm.entity.physical_tree_id).toBe('T4L-2030-KNM-000001');
    expect(knm.entity.serial_scope_key).toBe(`PLANTING_YEAR=${year2026}|PROJECT=${f.projectId}|VENDOR=${vendor}`);
    const grh = await register('1', other, vendorFmt.body.id);
    expect(grh.status).toBe('ACCEPTED');
    expect(grh.entity.physical_tree_id).toBe('T4L-2030-GRH-000001');
    expect((await register('1', vendor, vendorFmt.body.id)).status).toBe('CONFLICT');
    // The vendor is part of the ID: it is required, needs a short code and must be one of the year's vendors.
    expect((await register('2', null, vendorFmt.body.id)).code).toBe('VENDOR_REQUIRED');
    const [noCode] = await sql(`INSERT INTO vendors (name) VALUES ('Old Vendor') RETURNING id`);
    await admin.post(`/planting-years/${year2026}/vendors`, { vendor_id: noCode.id }).expect(201);
    const missing = await register('2', noCode.id, vendorFmt.body.id);
    expect(missing).toMatchObject({ status: 'REJECTED', code: 'VENDOR_CODE_MISSING', message: 'Vendor Old Vendor has no short code. Add one under Vendors.' });
    const outsider = (await admin.post('/vendors', { name: 'Elsewhere', short_code: 'ELS' }).expect(201)).body.id;
    expect((await register('2', outsider, vendorFmt.body.id)).code).toBe('VENDOR_NOT_IN_YEAR');
    // The web form gets the same refusal (REST maps rejections to 422).
    const rest422 = await admin.post('/trees', treePayload(f, '3', { planting_year_id: year2026, sector_id: sector26, sub_sector_id: sub26, id_scheme_id: vendorFmt.body.id, id_component_values: undefined })).expect(422);
    expect(rest422.body.code).toBe('VENDOR_REQUIRED');
    // The vendor cannot be swapped afterwards: the tree number belongs to the vendor's sequence.
    const swap = await admin.patch(`/trees/${knm.entity.id}`, { base_revision: knm.entity.revision, changes: { vendor_id: other } }).expect(422);
    expect(swap.body.code).toBe('VENDOR_IN_ID');

    // Vendors need a short code from now on.
    expect((await admin.post('/vendors', { name: 'No Code Ltd' }).expect(400)).body.code).toBe('VALIDATION_FAILED');

    // A format without the vendor: vendors share one sequence and the vendor is optional attribution.
    const fmt = await scheme({}).expect(201);
    const first = await register('15', vendor, fmt.body.id, { SECTOR_CODE: 'S01' });
    expect(first.status).toBe('ACCEPTED');
    expect(first.entity.physical_tree_id).toBe('T4L-2030-S01-00015');
    expect(first.entity.vendor_id).toBe(vendor);
    expect(first.entity.serial_scope_key).toBe(`PLANTING_YEAR=${year2026}|PROJECT=${f.projectId}`);
    expect((await register('15', other, fmt.body.id, { SECTOR_CODE: 'S01' })).status).toBe('CONFLICT');
    expect((await register('16', other, fmt.body.id, { SECTOR_CODE: 'S01' })).status).toBe('ACCEPTED');
    expect((await register('17', null, fmt.body.id, { SECTOR_CODE: 'S01' })).status).toBe('ACCEPTED');
  });

  it('gives a new project the PROJECT-YEAR-VENDOR-000001 format, numbered per vendor', async () => {
    const created = (await admin.post('/projects', { name: 'Vendor Default', short_code: 'VDF', physical_id_uniqueness: 'PROJECT' }).expect(201)).body;
    const project = (await admin.get(`/projects/${created.id}`).expect(200)).body;
    const [current] = project.tree_id_schemes.filter((s: any) => s.active);
    expect(current.component_definition.map((c: any) => c.type)).toEqual(['PROJECT_CODE', 'PLANTING_YEAR', 'VENDOR_CODE', 'SERIAL']);
    expect(current).toMatchObject({ separator: '-', serial_width: 6, serial_uniqueness_scope: ['PROJECT', 'PLANTING_YEAR', 'VENDOR'] });
  });

  it('lets Teasoo management executives see every project, while clients see only theirs', async () => {
    const other = (await admin.post('/projects', { name: 'Green Belt', short_code: 'GB1', physical_id_uniqueness: 'PROJECT' }).expect(201)).body.id;
    const client = await admin.post('/users', { username: 'sponsor1', full_name: 'Sponsor', role: 'EXECUTIVE', password: 'Str0ng!Passw0rd' }).expect(201);
    const mgmt = await admin.post('/users', { username: 'md.teasoo', full_name: 'Managing Director', role: 'EXECUTIVE', password: 'Str0ng!Passw0rd', all_projects: true }).expect(201);
    expect(mgmt.body.all_projects).toBe(true);
    const signIn = async (login: string) =>
      (await request(app.getHttpServer()).post('/api/v1/auth/login').send({ login, password: 'Str0ng!Passw0rd' }).expect(200)).body.access_token;
    const mgmtToken = await signIn('md.teasoo');
    const clientToken = await signIn('sponsor1');
    const list = async (token: string) =>
      (await request(app.getHttpServer()).get('/api/v1/projects').set('Authorization', `Bearer ${token}`).expect(200)).body.map((p: any) => p.id);
    expect(await list(mgmtToken)).toContain(other);
    expect(await list(clientToken)).toEqual([]);
    expect(client.body.all_projects).toBe(false);
  });
});

describe('visit types, hand-set replacement IDs and portal access', () => {
  it('records the type of each visit, defaulting to an ordinary visit, and filters by it', async () => {
    const payload = treePayload(f, '9101');
    payload.initial_observation = { ...payload.initial_observation, visit_type: 'FIRST_INSTANCE' } as any;
    expect((await sync(officer, [createOp(payload)])).body.results[0].status).toBe('ACCEPTED');
    const visit = await sync(officer, [observationOp(payload.id, f.status.ALIVE)]);
    expect(visit.body.results[0].entity.visit_type).toBe('VISIT');
    const maint = await sync(officer, [observationOp(payload.id, f.status.ALIVE, { visit_type: 'MAINTENANCE' })]);
    expect(maint.body.results[0].entity.visit_type).toBe('MAINTENANCE');
    // The app no longer asks for the type: omitted or null is an ordinary visit.
    const unset = await sync(officer, [observationOp(payload.id, f.status.ALIVE, { visit_type: null })]);
    expect(unset.body.results[0].entity.visit_type).toBe('VISIT');
    const bad = await sync(officer, [observationOp(payload.id, f.status.ALIVE, { visit_type: 'PICNIC' })]);
    expect(bad.body.results[0].status).toBe('REJECTED');
    const first = (await admin.get(`/reports/visits?visit_type=FIRST_INSTANCE&q=009101`).expect(200)).body;
    expect(first.items.map((v: any) => v.visit_type)).toEqual(['FIRST_INSTANCE']);
  });

  it('lets only an administrator give a replanted tree a hand-set ID, and correct it later', async () => {
    const original = treePayload(f, '9201');
    await sync(officer, [createOp(original)]);
    await sync(officer, [observationOp(original.id, f.status.DEAD)]);
    const replacement = (by: string) => treePayload(f, '1', { replaces_tree_id: original.id, custom_physical_id: by, physical_tree_id: undefined });
    const refused = await sync(officer, [createOp(replacement('REPL-0001'))]);
    expect(refused.body.results[0].code).toBe('CUSTOM_ID_NOT_ALLOWED');
    const ok = await sync(admin, [createOp(replacement('REPL-0001'))]);
    expect(ok.body.results[0].status).toBe('ACCEPTED');
    expect(ok.body.results[0].entity.physical_tree_id).toBe('REPL-0001');
    expect(ok.body.results[0].entity.replaces_tree_id).toBe(original.id);
    const noReplace = await sync(admin, [createOp(treePayload(f, '1', { custom_physical_id: 'X-1', physical_tree_id: undefined }))]);
    expect(noReplace.body.results[0].code).toBe('CUSTOM_ID_NOT_ALLOWED');
    await admin.post(`/trees/${ok.body.results[0].entity.id}/physical-id-corrections`, { serial_input: 'REPL-0002', reason: 'Typo on the tag' }).expect(200);
    const tree = (await admin.get(`/trees/${ok.body.results[0].entity.id}`).expect(200)).body;
    expect(tree.physical_tree_id).toBe('REPL-0002');
  });

  it('accepts the web portal from any Vercel address', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/auth/login')
      .set('Origin', 'https://tms-portal-git-main-teasoo.vercel.app')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBe('https://tms-portal-git-main-teasoo.vercel.app');
    const own = await request(app.getHttpServer()).options('/api/v1/auth/login').set('Origin', 'https://tms.teasooconsulting.com').set('Access-Control-Request-Method', 'POST');
    expect(own.headers['access-control-allow-origin']).toBe('https://tms.teasooconsulting.com');
    // A portal built with a trailing slash on the API address calls //api/v1/…
    await request(app.getHttpServer()).get('//api/v1/health').expect(200);
    const other = await request(app.getHttpServer()).options('/api/v1/auth/login').set('Origin', 'https://evil.example.com').set('Access-Control-Request-Method', 'POST');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('planting date, photos and the tree-density map', () => {
  const sq = (lat: number, lon: number, d: number) => [
    { latitude: lat, longitude: lon }, { latitude: lat, longitude: lon + d }, { latitude: lat + d, longitude: lon + d }, { latitude: lat + d, longitude: lon },
  ];
  let year: string;
  let sector: string;
  let sub: string;
  let scheme: string;
  const tree = (serial: string, overrides: Record<string, unknown> = {}) =>
    treePayload(f, serial, {
      planting_year_id: year, sector_id: sector, sub_sector_id: sub, id_scheme_id: scheme, id_component_values: undefined, physical_tree_id: undefined, ...overrides,
    });

  beforeAll(async () => {
    year = (await admin.post(`/projects/${f.projectId}/planting-years`, { year_label: '2031' }).expect(201)).body.id;
    sector = (await admin.post(`/projects/${f.projectId}/sectors`, { planting_year_id: year, name: 'Density', short_code: 'D1', corners: sq(7.60, 3.90, 0.01) }).expect(201)).body.id;
    sub = (await admin.post(`/sectors/${sector}/sub-sectors`, { name: 'Dense', short_code: 'DA', corners: sq(7.601, 3.901, 0.004) }).expect(201)).body.id;
    [{ id: scheme }] = await sql(`SELECT id FROM tree_id_schemes WHERE project_id = $1 AND active`, [f.projectId]);
  });

  it('defaults the planting date to the first visit when the app does not send one', async () => {
    const p = tree('501', { planted_on: undefined, initial_observation: { id: randomUUID(), status_id: f.status.ALIVE, observed_at: '2026-03-04T00:30:00+01:00' } });
    const r = (await sync(admin, [createOp(p)])).body.results[0];
    expect(r.status).toBe('ACCEPTED');
    expect(r.entity.planted_on).toBe('2026-03-04');
    const given = (await sync(admin, [createOp(tree('502', { planted_on: '2025-12-01' }))])).body.results[0];
    expect(given.entity.planted_on).toBe('2025-12-01');
  });

  it("lists a tree's photos for galleries", async () => {
    const [t] = await sql(`SELECT id FROM trees WHERE sub_sector_id = $1 LIMIT 1`, [sub]);
    expect((await admin.get(`/trees/${t.id}/media`).expect(200)).body).toEqual([]);
    await admin.get(`/trees/${randomUUID()}/media`).expect(404);
  });

  it('reports trees per hectare and the alive share by sector and sub-sector', async () => {
    const dead = tree('503', { initial_observation: { id: randomUUID(), status_id: f.status.DEAD, observed_at: '2026-03-05T10:00:00Z' } });
    expect((await sync(admin, [createOp(dead)])).body.results[0].status).toBe('ACCEPTED');
    const res = (await admin.get(`/reports/density?project_id=${f.projectId}&planting_year_id=${year}`).expect(200)).body;
    expect(res.project.id).toBe(f.projectId);
    expect(res.planting_year).toEqual({ id: year, year_label: '2031' });
    // Only this year's survey and older areas not tied to a year.
    expect(res.sectors.every((s: any) => s.planting_year_id === year || s.planting_year_id === null)).toBe(true);
    const s = res.sectors.find((x: any) => x.id === sector);
    expect(s).toMatchObject({ kind: 'sector', short_code: 'D1', registered_trees: 3, alive_trees: 2, dead_trees: 1, unknown_trees: 0, alive_share: 0.667 });
    expect(s.boundary.type).toBe('Polygon');
    expect(s.area_hectares).toBeGreaterThan(100); // ≈ 1.1 km × 1.1 km
    expect(s.area_hectares).toBeLessThan(140);
    expect(s.trees_per_hectare).toBeCloseTo(3 / s.area_hectares, 1);
    const ss = s.sub_sectors[0];
    expect(ss).toMatchObject({ kind: 'sub_sector', id: sub, sector_id: sector, registered_trees: 3 });
    expect(ss.trees_per_hectare).toBeGreaterThan(s.trees_per_hectare);
    // Trees of other years in older (year-less) areas are not counted for this year.
    expect(res.totals.registered_trees).toBe(3);

    // Executives read it for their projects; field officers do not.
    expect((await exec.get(`/reports/density?project_id=${f.projectId}&planting_year_id=${year}`).expect(200)).body.totals.registered_trees).toBe(3);
    await officer.get(`/reports/density?project_id=${f.projectId}`).expect(403);
    await admin.get(`/reports/density`).expect(400);
    await admin.get(`/reports/density?project_id=${f.projectId}&planting_year_id=${randomUUID()}`).expect(404);

    // Client share links get the same map for their project.
    const link = (await admin.post(`/projects/${f.projectId}/share-links`, { label: 'Density' }).expect(201)).body;
    const shared = (await request(app.getHttpServer()).get(`/api/v1/share/${link.token}/density?planting_year_id=${year}`).expect(200)).body;
    expect(shared.sectors.find((x: any) => x.id === sector).registered_trees).toBe(3);
  });
});

describe('species reference images', () => {
  let speciesId: string;
  let ids: string[];
  const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 120, b: 40 } } }).png().toBuffer();
  const upload = (s: Session, id: string) => request(app.getHttpServer()).post(`/api/v1/admin/species/${id}/images`).set('Authorization', `Bearer ${s.token}`);
  const bytes = (req: request.Test) =>
    req.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

  beforeAll(async () => {
    speciesId = (await admin.post('/tree-species', { scientific_name: 'Picturus exemplaris', common_name: 'Picture tree' }).expect(201)).body.id;
  });

  it('lets an administrator upload several photos, re-encoded with thumbnails, in order', async () => {
    const res = await upload(admin, speciesId)
      .attach('file', await png(2400, 1200), { filename: 'wide.png', contentType: 'image/png' })
      .attach('file', await sharp({ create: { width: 300, height: 500, channels: 3, background: '#884422' } }).jpeg().toBuffer(), { filename: 'small.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(res.body.images).toHaveLength(2);
    expect(res.body.images[0]).toEqual({
      id: expect.any(String), species_id: speciesId, sort_order: 0, caption: null, width: 1600, height: 800, byte_size: expect.any(Number), updated_at: expect.any(String),
    });
    expect(res.body.images[1]).toMatchObject({ sort_order: 1, width: 300, height: 500 }); // never enlarged
    ids = res.body.images.map((i: any) => i.id);
    const more = await upload(admin, speciesId).attach('file', await png(100, 100), { filename: 'c.png', contentType: 'image/png' }).expect(201);
    expect(more.body.images[0].sort_order).toBe(2);
    ids.push(more.body.images[0].id);
    const [audit] = await sql(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'species_image.create'`);
    expect(audit.n).toBe(3);
  });

  it('refuses other users, other file types and unreadable images', async () => {
    await upload(officer, speciesId).attach('file', await png(10, 10), { filename: 'a.png', contentType: 'image/png' }).expect(403);
    const gif = await upload(admin, speciesId).attach('file', Buffer.from('GIF89a'), { filename: 'a.gif', contentType: 'image/gif' }).expect(400);
    expect(gif.body.code).toBe('IMAGE_TYPE_UNSUPPORTED');
    const broken = await upload(admin, speciesId).attach('file', Buffer.from('not an image'), { filename: 'b.jpg', contentType: 'image/jpeg' }).expect(400);
    expect(broken.body.code).toBe('IMAGE_INVALID');
    expect((await upload(admin, speciesId).expect(400)).body.code).toBe('IMAGE_REQUIRED');
    const big = await upload(admin, speciesId).attach('file', Buffer.alloc(15 * 1024 * 1024 + 1), { filename: 'big.jpg', contentType: 'image/jpeg' }).expect(400);
    expect(big.body.code).toBe('IMAGE_TOO_LARGE');
    await officer.patch(`/admin/species-images/${ids[0]}`, { caption: 'x' }).expect(403);
    await officer.del(`/admin/species-images/${ids[0]}`).expect(403);
  });

  it('lists and serves the images to any signed-in user', async () => {
    const list = await exec.get(`/species/${speciesId}/images`).expect(200);
    expect(list.body.images.map((i: any) => i.id)).toEqual(ids);
    const thumb = await bytes(officer.get(`/species-images/${ids[0]}/content?size=thumb`)).expect(200);
    expect(thumb.headers['content-type']).toBe('image/jpeg');
    expect(thumb.headers['cache-control']).toBe('private, max-age=86400');
    const tm = await sharp(thumb.body as Buffer).metadata();
    expect([tm.format, tm.width, tm.height]).toEqual(['jpeg', 400, 200]);
    const full = await bytes(officer.get(`/species-images/${ids[0]}/content`)).expect(200);
    expect((full.body as Buffer).length).toBe(list.body.images[0].byte_size);
    expect((await sharp(full.body as Buffer).metadata()).width).toBe(1600);
    await officer.get(`/species-images/${randomUUID()}/content`).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/species-images/${ids[0]}/content`).expect(401);
  });

  it('reorders, captions and deletes, and phones receive the changes', async () => {
    const boot = await officer.get('/mobile/bootstrap').expect(200);
    expect(boot.body.species_images.filter((i: any) => i.species_id === speciesId).map((i: any) => i.id).sort()).toEqual([...ids].sort());
    const cursor = boot.body.cursor;

    const patched = await admin.patch(`/admin/species-images/${ids[2]}`, { sort_order: -1, caption: 'Leaves' }).expect(200);
    expect(patched.body).toMatchObject({ id: ids[2], sort_order: -1, caption: 'Leaves' });
    expect((await admin.get(`/species/${speciesId}/images`).expect(200)).body.images[0].id).toBe(ids[2]);
    expect((await admin.patch(`/admin/species-images/${ids[2]}`, { caption: null }).expect(200)).body.caption).toBeNull();
    await admin.patch(`/admin/species-images/${ids[2]}`, {}).expect(400);

    const [{ object_key: key }] = await sql('SELECT object_key FROM species_images WHERE id = $1', [ids[1]]);
    await admin.del(`/admin/species-images/${ids[1]}`).expect(204);
    await admin.del(`/admin/species-images/${ids[1]}`).expect(404);
    await officer.get(`/species-images/${ids[1]}/content`).expect(404);
    const changes = (await officer.get(`/sync/changes?cursor=${cursor}`).expect(200)).body.changes.filter((c: any) => c.entity_type === 'species_image');
    expect(changes).toEqual([
      expect.objectContaining({ entity_type: 'species_image', data: expect.objectContaining({ id: ids[2], caption: null, sort_order: -1 }) }),
      expect.objectContaining({ entity_type: 'species_image', deleted: true, data: { id: ids[1] } }),
    ]);
    const actions = await sql(`SELECT action FROM audit_logs WHERE entity_type = 'species_image' AND action <> 'species_image.create' ORDER BY created_at`);
    expect(actions.map((a) => a.action)).toEqual(['species_image.update', 'species_image.update', 'species_image.delete']);
    await new Promise((r) => setTimeout(r, 50)); // stored files are removed after the response
    expect(fs.existsSync(path.join(process.env.LOCAL_STORAGE_DIR!, key))).toBe(false);
  });

  it('removes the photos with their species', async () => {
    const cursor = (await officer.get('/mobile/bootstrap').expect(200)).body.cursor;
    const [{ thumb_key: key }] = await sql('SELECT thumb_key FROM species_images WHERE id = $1', [ids[0]]);
    await admin.del(`/tree-species/${speciesId}`).expect(200);
    expect(await sql('SELECT count(*)::int AS n FROM species_images WHERE species_id = $1', [speciesId])).toEqual([{ n: 0 }]);
    const tombstones = (await officer.get(`/sync/changes?cursor=${cursor}`).expect(200)).body.changes.filter((c: any) => c.deleted);
    expect(tombstones.map((c: any) => c.entity_type).sort()).toEqual(['species', 'species_image', 'species_image']);
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(path.join(process.env.LOCAL_STORAGE_DIR!, key))).toBe(false);
  });
});

describe('field sessions and the field-activity report', () => {
  const sq = (lat: number, lon: number, d: number) => [
    { latitude: lat, longitude: lon }, { latitude: lat, longitude: lon + d }, { latitude: lat + d, longitude: lon + d }, { latitude: lat + d, longitude: lon },
  ];
  const S1 = randomUUID();
  const S2 = randomUUID();
  let project: string;
  let base: Record<string, unknown>;
  const report = (s: Session, query: string) => s.get(`/reports/field-activity?project_id=${project}&${query}`);

  beforeAll(async () => {
    project = (await admin.post('/projects', { name: 'Field Activity', short_code: 'FAC', physical_id_uniqueness: 'PROJECT', status: 'ACTIVE' }).expect(201)).body.id;
    const year = (await admin.post(`/projects/${project}/planting-years`, { year_label: '2026' }).expect(201)).body.id;
    const sector = (await admin.post(`/projects/${project}/sectors`, { planting_year_id: year, name: 'FA', short_code: 'FA1', corners: sq(8.0, 4.0, 0.01) }).expect(201)).body.id;
    const sub = (await admin.post(`/sectors/${sector}/sub-sectors`, { name: 'FA a', short_code: 'FAA', corners: sq(8.001, 4.001, 0.004) }).expect(201)).body.id;
    const vendor = (await admin.post('/vendors', { name: 'Field Vendor', short_code: 'FAV' }).expect(201)).body.id;
    await admin.post(`/planting-years/${year}/vendors`, { vendor_id: vendor }).expect(201);
    await admin.post('/assignments', { user_id: f.officerId, project_id: project }).expect(201);
    const [scheme] = await sql('SELECT id FROM tree_id_schemes WHERE project_id = $1 AND active', [project]);
    base = { project_id: project, planting_year_id: year, sector_id: sector, sub_sector_id: sub, vendor_id: vendor, id_scheme_id: scheme.id, id_component_values: undefined };
  });

  const register = async (s: Session, serial: string, observedAt: string, session?: string) => {
    const p = treePayload(f, serial, { ...base, initial_observation: { id: randomUUID(), status_id: f.status.ALIVE, observed_at: observedAt, field_session_id: session } });
    const r = (await sync(s, [createOp(p)])).body.results[0];
    expect(r.status).toBe('ACCEPTED');
    return { tree: r.entity, observationId: p.initial_observation.id };
  };

  it('stores the field session sent with registrations and visits, and accepts apps that send none', async () => {
    // 23:30 UTC on the 20th is 00:30 on the 21st in Lagos (UTC+1).
    const t1 = await register(officer, '1', '2026-10-20T23:30:00Z', S1);
    expect(t1.tree.physical_tree_id).toBe('FAC-2026-FAV-000001');
    await register(officer, '2', '2026-10-21T08:00:00Z', S1);
    const visit = observationOp(t1.tree.id, f.status.ALIVE, { observed_at: '2026-10-21T09:00:00Z', field_session_id: S1 });
    expect((await sync(officer, [visit])).body.results[0].entity.field_session_id).toBe(S1);
    const fix = observationOp(t1.tree.id, f.status.ALIVE, { observed_at: '2026-10-21T09:30:00Z', field_session_id: S1, amends_observation_id: visit.entity_id, amendment_reason: 'Wrong status' });
    expect((await sync(officer, [fix])).body.results[0].status).toBe('ACCEPTED');
    // No session (older app): grouped per officer and day.
    const t3 = await register(officer, '3', '2026-10-21T10:00:00Z');
    expect((await sync(officer, [observationOp(t3.tree.id, f.status.ALIVE, { observed_at: '2026-10-21T11:00:00Z', field_session_id: null })])).body.results[0].status).toBe('ACCEPTED');
    const bad = await sync(officer, [observationOp(t3.tree.id, f.status.ALIVE, { field_session_id: 'not-a-uuid' })]);
    expect(bad.body.results[0]).toMatchObject({ status: 'REJECTED', code: 'VALIDATION_FAILED' });
    // Photos of the first registration; a rejected tree is left out.
    for (const id of [randomUUID(), randomUUID()]) {
      await sql(
        `INSERT INTO tree_media (id, tree_id, observation_id, checksum_sha256, byte_size, mime_type, captured_at) VALUES ($1, $2, $3, $4, 1000, 'image/jpeg', now())`,
        [id, t1.tree.id, t1.observationId, 'a'.repeat(64)],
      );
    }
    const t5 = await register(officer, '5', '2026-10-21T12:00:00Z', S1);
    await sql(`UPDATE trees SET record_state = 'REJECTED' WHERE id = $1`, [t5.tree.id]);
    await register(admin, '4', '2026-10-22T09:00:00Z', S2);
    const [stored] = await sql('SELECT field_session_id FROM tree_observations WHERE id = $1', [t1.observationId]);
    expect(stored.field_session_id).toBe(S1);
  });

  it('counts per officer, day and session in the caller’s time zone', async () => {
    const r = (await report(admin, 'from=2026-10-21&to=2026-10-22&tz=Africa/Lagos').expect(200)).body;
    expect(r).toMatchObject({ from: '2026-10-21', to: '2026-10-22', tz: 'Africa/Lagos' });
    expect(r.days.map((d: any) => [d.date, d.user_id])).toEqual([['2026-10-22', expect.any(String)], ['2026-10-21', f.officerId]]);
    expect(r.days[1].user_name).toBe('Femi Field Officer');
    const day = r.days.find((d: any) => d.date === '2026-10-21');
    expect(day).toMatchObject({ user_id: f.officerId, trees_registered: 3, visits: 2, corrections: 1, photos: 2, first_at: '2026-10-20T23:30:00.000Z', last_at: '2026-10-21T11:00:00.000Z' });
    expect(day.sessions).toHaveLength(2);
    expect(day.sessions[0]).toMatchObject({
      field_session_id: S1, project_id: project, project_name: 'Field Activity', planting_year: '2026', sectors: ['FA1'], sub_sectors: ['FA1/FAA'], vendors: ['FAV'],
      trees_registered: 2, visits: 1, corrections: 1, photos: 2, first_at: '2026-10-20T23:30:00.000Z', last_at: '2026-10-21T09:30:00.000Z',
    });
    expect(day.sessions[1]).toMatchObject({ field_session_id: null, trees_registered: 1, visits: 1, corrections: 0, photos: 0 });
    expect(r.officers.map((o: any) => o.user_id)[0]).toBe(f.officerId);
    expect(r.officers[0]).toMatchObject({ role: 'FIELD_OFFICER', trees_registered: 3, visits: 2, corrections: 1, photos: 2, days_active: 1, sessions: 2 });
    expect(r.officers[1]).toMatchObject({ role: 'ADMIN', trees_registered: 1, sessions: 1 });

    // In UTC the first registration falls on the 20th.
    const utc = (await report(admin, 'from=2026-10-21&to=2026-10-21').expect(200)).body;
    expect(utc.tz).toBe('UTC');
    expect(utc.days).toHaveLength(1);
    expect(utc.days[0].trees_registered).toBe(2);
    const only = (await report(admin, `from=2026-10-20&to=2026-10-22&tz=Africa/Lagos&user_id=${f.officerId}`).expect(200)).body;
    expect(only.officers.map((o: any) => o.user_id)).toEqual([f.officerId]);
  });

  it('validates the query and defaults to the last 7 days', async () => {
    expect((await report(admin, 'tz=Mars/Olympus').expect(400)).body.code).toBe('TIME_ZONE_UNKNOWN');
    await report(admin, 'from=2026-10-22&to=2026-10-21').expect(400);
    await report(admin, 'from=2026-02-30').expect(400);
    const d = (await report(admin, 'tz=Africa/Lagos').expect(200)).body;
    expect((Date.parse(d.to) - Date.parse(d.from)) / 86_400_000).toBe(6);
  });

  it('is for administrators and executives, within their projects', async () => {
    await officer.get('/reports/field-activity').expect(403);
    await report(exec, 'from=2026-10-21&to=2026-10-22').expect(403); // eli is assigned to Trees for Life only
    const mine = (await exec.get('/reports/field-activity?from=2026-10-21&to=2026-10-22').expect(200)).body;
    expect(mine.days.flatMap((d: any) => d.sessions).some((x: any) => x.project_id === project)).toBe(false);
  });

  it('exports one CSV row per session', async () => {
    const file = await admin.get(`/reports/field-activity.csv?project_id=${project}&from=2026-10-21&to=2026-10-22&tz=Africa/Lagos`).expect(200).expect('Content-Type', /text\/csv/);
    const lines = file.text.trim().split('\n');
    expect(lines[0]).toContain('date,user_name,first_at,last_at,project_name,planting_year,sectors,sub_sectors,vendors,trees_registered,visits,corrections,photos,field_session_id');
    expect(lines).toHaveLength(4);
    expect(lines.find((l) => l.includes(S1))).toContain('FA1/FAA');
  });
});

describe('migration 007: tree IDs per project and planting year', () => {
  const file = path.resolve(__dirname, '../../migrations/007_project_year_tree_ids.sql');
  const definition = (types: string[]) => JSON.stringify(types.map((type) => ({ type, required: true })));

  it('retires vendor and year formats and leaves every project with one project format', async () => {
    await sql('ALTER TABLE tree_id_schemes DROP CONSTRAINT tree_id_schemes_project_wide');
    const [vendor] = await sql(`INSERT INTO vendors (name, short_code) VALUES ('Migration Vendor', 'MIGV') RETURNING id`);
    const project = async (code: string) => {
      const [p] = await sql(`INSERT INTO projects (name, short_code, physical_id_uniqueness) VALUES ($1, $1, 'PROJECT') RETURNING id`, [code]);
      const [y] = await sql(`INSERT INTO planting_years (project_id, year_label) VALUES ($1, '2027') RETURNING id`, [p.id]);
      return { id: p.id as string, year: y.id as string };
    };
    const insert = (projectId: string, version: number, types: string[], scope: string[], vendorId: string | null = null, yearId: string | null = null) =>
      sql(
        `INSERT INTO tree_id_schemes (project_id, version, component_definition, separator, serial_width, serial_uniqueness_scope, vendor_id, planting_year_id)
         VALUES ($1, $2, $3, '-', 5, $4, $5, $6)`,
        [projectId, version, definition(types), JSON.stringify(scope), vendorId, yearId],
      );
    // A: a project format that names the vendor, plus a vendor format and a year format.
    const a = await project('MIGA');
    await insert(a.id, 1, ['PROJECT_CODE', 'VENDOR_CODE', 'SERIAL'], ['PROJECT', 'PLANTING_YEAR', 'VENDOR']);
    await insert(a.id, 2, ['PROJECT_CODE', 'VENDOR_CODE', 'TEXT', 'SERIAL'], ['VENDOR'], vendor.id);
    await insert(a.id, 3, ['PROJECT_CODE', 'SECTOR_CODE', 'SERIAL'], ['SECTOR'], null, a.year);
    // B: only a year format (globally numbered). C: no format at all.
    const b = await project('MIGB');
    await insert(b.id, 1, ['PROJECT_CODE', 'PLANTING_YEAR', 'VENDOR_CODE', 'SERIAL'], [], null, b.year);
    const c = await project('MIGC');

    await sql(fs.readFileSync(file, 'utf8'));
    const active = async (projectId: string) => sql(`SELECT * FROM tree_id_schemes WHERE project_id = $1 AND active`, [projectId]);
    const types = (row: any) => row.component_definition.map((x: any) => x.type);

    const [fa] = await active(a.id);
    expect(fa).toMatchObject({ version: 4, vendor_id: null, planting_year_id: null, serial_uniqueness_scope: ['PROJECT', 'PLANTING_YEAR'] });
    expect(types(fa)).toEqual(['PROJECT_CODE', 'SERIAL']);
    const [{ n: kept }] = await sql(`SELECT count(*)::int AS n FROM tree_id_schemes WHERE project_id = $1 AND NOT active`, [a.id]);
    expect(kept).toBe(3); // history rows stay, so registered IDs keep their format
    const [fb] = await active(b.id);
    expect(fb).toMatchObject({ version: 2, planting_year_id: null, serial_uniqueness_scope: [] });
    expect(types(fb)).toEqual(['PROJECT_CODE', 'PLANTING_YEAR', 'SERIAL']);
    const [fc] = await active(c.id);
    expect(fc).toMatchObject({ version: 1, separator: '-', serial_width: 6, serial_uniqueness_scope: ['PROJECT', 'PLANTING_YEAR'] });
    expect(types(fc)).toEqual(['PROJECT_CODE', 'PLANTING_YEAR', 'SERIAL']);
    const counts = await sql(`SELECT p.id, (SELECT count(*)::int FROM tree_id_schemes s WHERE s.project_id = p.id AND s.active) AS n FROM projects p`);
    expect(counts.every((r: any) => r.n === 1)).toBe(true);

    // Running it again changes nothing; vendor formats cannot become active again.
    const [{ n: before }] = await sql('SELECT count(*)::int AS n FROM tree_id_schemes');
    await sql(fs.readFileSync(file, 'utf8'));
    expect((await sql('SELECT count(*)::int AS n FROM tree_id_schemes'))[0].n).toBe(before);
    await expect(insert(a.id, 9, ['SERIAL'], [], vendor.id)).rejects.toThrow(/tree_id_schemes_project_wide/);
  });
});

describe('migration 009: vendor code in tree IDs', () => {
  const file = path.resolve(__dirname, '../../migrations/009_vendor_tree_ids_and_field_sessions.sql');

  it('adds the vendor code before the tree number and numbers per vendor, once', async () => {
    const project = async (code: string, components: unknown[], scope: string[]) => {
      const [p] = await sql(`INSERT INTO projects (name, short_code, physical_id_uniqueness) VALUES ($1, $1, 'PROJECT') RETURNING id`, [code]);
      await sql(
        `INSERT INTO tree_id_schemes (project_id, version, component_definition, separator, serial_width, serial_uniqueness_scope) VALUES ($1, 3, $2, '-', 5, $3)`,
        [p.id, JSON.stringify(components), JSON.stringify(scope)],
      );
      return p.id as string;
    };
    const r = (type: string, extra = {}) => ({ type, required: true, ...extra });
    const a = await project('M9A', [r('PROJECT_CODE'), r('PLANTING_YEAR'), r('SERIAL')], ['PROJECT', 'PLANTING_YEAR']);
    const b = await project('M9B', [r('PROJECT_CODE'), r('TEXT', { value: 'TR' }), r('SECTOR_CODE'), r('SERIAL')], []);
    const c = await project('M9C', [r('PROJECT_CODE'), r('VENDOR_CODE'), r('SERIAL')], ['PROJECT', 'VENDOR']);
    const ids = await sql('SELECT id, physical_tree_id, id_components_snapshot FROM trees ORDER BY id');

    await sql(fs.readFileSync(file, 'utf8'));
    const active = async (id: string) => (await sql('SELECT * FROM tree_id_schemes WHERE project_id = $1 AND active', [id]))[0];
    const fa = await active(a);
    expect(fa).toMatchObject({ version: 4, separator: '-', serial_width: 5, serial_uniqueness_scope: ['PROJECT', 'PLANTING_YEAR', 'VENDOR'], vendor_id: null });
    expect(fa.component_definition).toEqual([r('PROJECT_CODE'), r('PLANTING_YEAR'), r('VENDOR_CODE'), r('SERIAL')]);
    const fb = await active(b);
    expect(fb.serial_uniqueness_scope).toEqual([]); // global numbering stays global
    expect(fb.component_definition).toEqual([r('PROJECT_CODE'), r('TEXT', { value: 'TR' }), r('SECTOR_CODE'), r('VENDOR_CODE'), r('SERIAL')]);
    expect((await active(c)).version).toBe(3);
    const counts = await sql(`SELECT p.id, (SELECT count(*)::int FROM tree_id_schemes s WHERE s.project_id = p.id AND s.active) AS n FROM projects p`);
    expect(counts.every((x: any) => x.n === 1)).toBe(true);
    const formats = await sql(`SELECT component_definition FROM tree_id_schemes WHERE active`);
    expect(formats.every((x: any) => x.component_definition.some((p: any) => p.type === 'VENDOR_CODE'))).toBe(true);
    // Registered trees keep their IDs and snapshots.
    expect(await sql('SELECT id, physical_tree_id, id_components_snapshot FROM trees ORDER BY id')).toEqual(ids);

    const [{ n: before }] = await sql('SELECT count(*)::int AS n FROM tree_id_schemes');
    await sql(fs.readFileSync(file, 'utf8'));
    expect((await sql('SELECT count(*)::int AS n FROM tree_id_schemes'))[0].n).toBe(before);
    const cols = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = 'tree_observations' AND column_name = 'field_session_id'`);
    expect(cols).toHaveLength(1);
  });
});

describe('areas without GPS', () => {
  const sq = (lat: number, lon: number, d: number) => [
    { latitude: lat, longitude: lon }, { latitude: lat, longitude: lon + d }, { latitude: lat + d, longitude: lon + d }, { latitude: lat + d, longitude: lon },
  ];
  const noLocation = { reference_latitude: null, reference_longitude: null, boundary: null };
  let year: string;
  let bare: string; // sector with no location
  let bareSub: string; // its sub-sector, no location either
  let walked: string; // sector with corners

  it('creates sectors and sub-sectors from a name and short code alone', async () => {
    year = (await admin.post(`/projects/${f.projectId}/planting-years`, { year_label: '2032' }).expect(201)).body.id;
    const s = await admin.post(`/projects/${f.projectId}/sectors`, { planting_year_id: year, name: 'Not walked', short_code: 'G1' }).expect(201);
    bare = s.body.id;
    expect(s.body).toMatchObject(noLocation);
    const ss = await admin.post(`/sectors/${bare}/sub-sectors`, { name: 'Not walked a', short_code: 'GA' }).expect(201);
    bareSub = ss.body.id;
    expect(ss.body).toMatchObject(noLocation);
    // A located sub-sector under a sector without GPS: nothing to check it against.
    const located = await admin.post(`/sectors/${bare}/sub-sectors`, { name: 'Walked b', short_code: 'GB', corners: sq(9.0, 5.0, 0.002) }).expect(201);
    expect(located.body.boundary.type).toBe('Polygon');
    expect(located.body.reference_latitude).toBeGreaterThan(9.0);
    // And a sub-sector without GPS under a sector with an outline.
    walked = (await admin.post(`/projects/${f.projectId}/sectors`, { planting_year_id: year, name: 'Walked', short_code: 'G2', corners: sq(9.1, 5.1, 0.01) }).expect(201)).body.id;
    expect((await admin.post(`/sectors/${walked}/sub-sectors`, { name: 'Later', short_code: 'GC' }).expect(201)).body).toMatchObject(noLocation);
    // A reference point is whole or absent.
    const half = await admin.post(`/projects/${f.projectId}/sectors`, { planting_year_id: year, name: 'Half', short_code: 'G3', reference_latitude: 9.2 }).expect(400);
    expect(half.body.code).toBe('REFERENCE_POINT_INCOMPLETE');
  });

  it('adds corners later, keeps the location on other edits and can clear it', async () => {
    const renamed = (await admin.patch(`/sectors/${bare}`, { name: 'Still not walked' }).expect(200)).body;
    expect(renamed).toMatchObject({ name: 'Still not walked', ...noLocation });
    const located = (await admin.patch(`/sectors/${bare}`, { corners: sq(9.0, 5.0, 0.01) }).expect(200)).body;
    expect(located.boundary.type).toBe('Polygon');
    expect(located.reference_latitude).toBeGreaterThan(9.0);
    expect(located.reference_longitude).toBeGreaterThan(5.0);
    const kept = (await admin.patch(`/sectors/${bare}`, { description: 'Walked in March' }).expect(200)).body;
    expect(kept.boundary).toEqual(located.boundary);
    expect(kept.reference_latitude).toBe(located.reference_latitude);
    // The sub-sector without GPS is unaffected by its sector getting an outline, and gets corners inside it.
    const far = await admin.patch(`/sub-sectors/${bareSub}`, { corners: sq(9.5, 5.5, 0.002) }).expect(400);
    expect(far.body.code).toBe('GEOMETRY_OUTSIDE_PARENT');
    const sub = (await admin.patch(`/sub-sectors/${bareSub}`, { reference_latitude: 9.005, reference_longitude: 5.005 }).expect(200)).body;
    expect(sub).toMatchObject({ boundary: null, reference_latitude: 9.005, reference_longitude: 5.005 });
    expect((await admin.patch(`/sub-sectors/${bareSub}`, { reference_latitude: null, reference_longitude: null }).expect(200)).body).toMatchObject(noLocation);
    // Clearing the outline (with no reference point given) clears the location; the sector is back to "no GPS".
    await admin.patch(`/sectors/${bare}`, { boundary: null }).expect(200);
    expect((await admin.get(`/projects/${f.projectId}/areas?planting_year_id=${year}`).expect(200)).body.find((a: any) => a.id === bare)).toMatchObject(noLocation);
  });

  it('sends nulls to devices and keeps reports and exports working', async () => {
    const boot = (await admin.get('/mobile/bootstrap').expect(200)).body;
    expect(boot.sectors.find((s: any) => s.id === bare)).toMatchObject(noLocation);
    expect(boot.sub_sectors.find((s: any) => s.id === bareSub)).toMatchObject(noLocation);
    await admin.patch(`/sub-sectors/${bareSub}`, { name: 'Renamed' }).expect(200);
    const changes = (await admin.get(`/sync/changes?cursor=${boot.cursor}`).expect(200)).body.changes;
    expect(changes.find((c: any) => c.entity_type === 'sub_sector' && c.data.id === bareSub).data).toMatchObject({ name: 'Renamed', ...noLocation });

    const density = (await admin.get(`/reports/density?project_id=${f.projectId}&planting_year_id=${year}`).expect(200)).body;
    const s = density.sectors.find((x: any) => x.id === bare);
    expect(s).toMatchObject({ area_hectares: null, trees_per_hectare: null, ...noLocation });
    expect(s.sub_sectors.find((x: any) => x.id === bareSub)).toMatchObject({ area_hectares: null, ...noLocation });
    expect(density.sectors.find((x: any) => x.id === walked).area_hectares).toBeGreaterThan(100);

    const geo = (await admin.get(`/projects/${f.projectId}/areas.geojson`).expect(200)).body;
    expect(geo.features.find((x: any) => x.properties.id === bare).geometry).toBeNull();
    await admin.get(`/reports/export.xlsx?project_id=${f.projectId}`).expect(200);
    await admin.get(`/reports/summary?project_id=${f.projectId}`).expect(200);
    const link = (await admin.post(`/projects/${f.projectId}/share-links`, { label: 'No GPS' }).expect(201)).body;
    const view = (await request(app.getHttpServer()).get(`/api/v1/share/${link.token}`).expect(200)).body;
    expect(view.areas.find((a: any) => a.id === bare)).toMatchObject({ reference_latitude: null, boundary: null });
  });

  it('migration 010 keeps a reference point whole and runs again safely', async () => {
    const file = path.resolve(__dirname, '../../migrations/010_optional_area_location.sql');
    await sql(fs.readFileSync(file, 'utf8'));
    await expect(sql('UPDATE sectors SET reference_latitude = 9 WHERE id = $1', [bare])).rejects.toThrow(/sectors_reference_point_whole/);
    await expect(sql('UPDATE sub_sectors SET reference_longitude = 5 WHERE id = $1', [bareSub])).rejects.toThrow(/sub_sectors_reference_point_whole/);
    await sql('UPDATE sub_sectors SET reference_latitude = 9, reference_longitude = 5 WHERE id = $1', [bareSub]);
    await expect(sql('UPDATE sectors SET reference_latitude = 95, reference_longitude = 5 WHERE id = $1', [bare])).rejects.toThrow(/check constraint/);
  });
});
