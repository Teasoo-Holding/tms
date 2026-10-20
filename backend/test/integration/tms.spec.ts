import { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import request from 'supertest';
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
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refresh_token: s.refresh }).expect(401);
    // Reuse revokes the whole family, including the newly issued token.
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refresh_token: first.body.refresh_token }).expect(401);
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
    const bad = await admin.post(`/projects/${f.projectId}/sectors`, { name: 'Bad', short_code: 'S99', reference_latitude: 0.5, reference_longitude: 0.5, boundary: bowtie }).expect(400);
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
    expect(csv.text.split('\n')[0]).toContain('observed_at,physical_tree_id');
  });
});
