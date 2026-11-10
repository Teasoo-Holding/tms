// The harness first: it points the app's config at the test database before config is loaded.
import { bootApp, resetDatabase, Session, sql } from './harness';
import { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import request from 'supertest';
import { config } from '../../src/config';
import { SpeciesCheckService } from '../../src/species/species-check.service';
import { createOp, Fixtures, loadFixtures, treePayload } from './fixtures';

let app: INestApplication;
let f: Fixtures;
let admin: Session;
let officer: Session;
let checks: SpeciesCheckService;
/** What the stand-in for Pl@ntNet answers, by photo colour (the first byte of the JPEG body differs). */
const answers = new Map<string, { name: string; score: number }[]>();

beforeAll(async () => {
  await resetDatabase();
  app = await bootApp();
  f = await loadFixtures();
  admin = await new Session(app, 'admin@tms.local').login();
  officer = await new Session(app, 'officer@tms.local').login();
  checks = app.get(SpeciesCheckService);
  checks.identify = async (photo) => {
    const a = answers.get(createHash('sha256').update(photo).digest('hex')) ?? [];
    return { results: a.map((x) => ({ ...x, genus: x.name.split(' ')[0], commonNames: [] })), remaining: 400 };
  };
});
afterAll(async () => {
  (config as any).plantnetApiKey = null;
  await app.close();
});

async function treeWithPhoto(serial: string, colour: string, answer: { name: string; score: number }[]) {
  const sharp = (await import('sharp')).default;
  const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: colour } }).jpeg().toBuffer();
  const sha = createHash('sha256').update(jpeg).digest('hex');
  answers.set(sha, answer);
  const p = treePayload(f, serial);
  await officer.post('/sync/batches', { device_id: officer.deviceId, operations: [createOp(p)] }).expect(200);
  const s = await officer
    .post('/media/upload-sessions', { media_id: randomUUID(), tree_id: p.id, observation_id: p.initial_observation.id, checksum_sha256: sha, byte_size: jpeg.length, mime_type: 'image/jpeg', captured_at: new Date().toISOString() })
    .expect(201);
  const u = new URL(s.body.upload_url);
  await request(app.getHttpServer()).put(u.pathname + u.search).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
  await officer.post(`/media/${s.body.media.id}/complete`).expect(200);
  return p.id as string;
}

describe('species check', () => {
  it('is off without a Pl@ntNet key', async () => {
    (config as any).plantnetApiKey = null;
    expect((await admin.get('/species-checks/status').expect(200)).body.enabled).toBe(false);
    expect(await checks.run()).toBe(0);
    await officer.get('/species-checks/status').expect(403);
  });

  let wrongTree: string;
  it('checks a sample of registration photos and queues clear disagreements', async () => {
    (config as any).plantnetApiKey = 'test-key';
    await treeWithPhoto('901', '#2e7d32', [{ name: 'Azadirachta indica', score: 0.8 }]);
    wrongTree = await treeWithPhoto('902', '#8d6e63', [{ name: 'Khaya senegalensis', score: 0.75 }, { name: 'Azadirachta indica', score: 0.01 }]);
    await treeWithPhoto('903', '#1565c0', [{ name: 'Ficus exasperata', score: 0.2 }]);
    expect(await checks.run(new Date(new Date().toISOString().slice(0, 10) + 'T23:00:00Z'))).toBe(3);
    // Already checked photos are not sent again.
    expect(await checks.run(new Date(new Date().toISOString().slice(0, 10) + 'T23:00:00Z'))).toBe(0);
    const verdicts = (await sql(`SELECT verdict, review_state FROM species_checks ORDER BY verdict`)).map((r) => [r.verdict, r.review_state]);
    expect(verdicts).toEqual([['AGREE', null], ['DISAGREE', 'OPEN'], ['UNSURE', null]]);
    const status = (await admin.get('/species-checks/status').expect(200)).body;
    expect(status).toMatchObject({ enabled: true, checked_today: 3, daily_limit: 450 });

    const open = (await admin.get(`/species-checks?project_id=${f.projectId}`).expect(200)).body;
    expect(open.total).toBe(1);
    expect(open.items[0]).toMatchObject({
      tree_id: wrongTree, verdict: 'DISAGREE', claimed_scientific_name: 'Azadirachta indica', top_name: 'Khaya senegalensis',
      suggested_scientific_name: 'Khaya senegalensis', recorded_by_name: 'Femi Field Officer',
    });
  });

  it('shows the traffic light and likelihood on the tree list, with a filter and sort', async () => {
    // Colours follow the officer's species' score: 60%+ green, 25%+ amber, below red.
    await sql(`UPDATE species_checks c SET claimed_score = 0.4 FROM trees t WHERE t.id = c.tree_id AND t.serial_number LIKE '%903'`);
    const red = (await admin.get('/trees?species_match=red').expect(200)).body;
    expect(red.total).toBe(1);
    expect(red.items[0]).toMatchObject({ id: wrongTree, species_match: 'red', species_match_score: 0.01 });
    expect((await admin.get('/trees?species_match=green').expect(200)).body.items[0]).toMatchObject({ species_match: 'green', species_match_score: 0.8 });
    expect((await admin.get('/trees?species_match=amber').expect(200)).body.items[0]).toMatchObject({ species_match: 'amber', species_match_score: 0.4 });
    const sorted = (await admin.get('/trees?sort=species_match').expect(200)).body.items.map((t: any) => t.species_match);
    expect(sorted.slice(0, 3)).toEqual(['red', 'amber', 'green']);
    expect(sorted.slice(3).every((m: string) => m === 'unchecked')).toBe(true);
  });

  it('lets an administrator correct the species, which phones then receive', async () => {
    const open = (await admin.get('/species-checks').expect(200)).body.items[0];
    await admin.post(`/species-checks/${open.id}/review`, { action: 'correct' }).expect(400);
    await admin.post(`/species-checks/${open.id}/review`, { action: 'correct', species_id: open.suggested_species_id }).expect(200);
    expect((await sql('SELECT species_id FROM trees WHERE id = $1', [wrongTree]))[0].species_id).toBe(open.suggested_species_id);
    expect((await admin.get('/species-checks').expect(200)).body.total).toBe(0);
    const reviewed = (await admin.get('/species-checks?state=reviewed').expect(200)).body.items[0];
    expect(reviewed).toMatchObject({ review_state: 'CORRECTED', reviewed_by_name: 'Ada Administrator', current_scientific_name: 'Khaya senegalensis' });
    expect((await sql(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'species_check.correct'`))[0].n).toBe(1);
    // Confirmed by an administrator: green.
    expect((await admin.get(`/trees/${wrongTree}`).expect(200)).body).toMatchObject({ species_match: 'green', species_match_review: 'CORRECTED' });
  });

  it('reports agreement per officer and per species', async () => {
    const a = (await admin.get(`/species-checks/agreement?project_id=${f.projectId}`).expect(200)).body;
    expect(a.totals).toMatchObject({ checked: 3, agree: 1, disagree: 1, unsure: 1, corrected: 1, agreement_rate: 0.5 });
    expect(a.by_officer[0]).toMatchObject({ name: 'Femi Field Officer', checked: 3 });
    expect(a.by_species[0]).toMatchObject({ scientific_name: 'Azadirachta indica', checked: 3 });
  });
});
