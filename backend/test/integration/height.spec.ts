// The harness first: it points the app's config at the test database before config is loaded.
import { bootApp, resetDatabase, Session, sql } from './harness';
import { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import request from 'supertest';
import { config } from '../../src/config';
import { HeightService, heightFrom } from '../../src/height/height.service';
import { createOp, Fixtures, loadFixtures, treePayload } from './fixtures';

let app: INestApplication;
let f: Fixtures;
let admin: Session;
let officer: Session;
let heights: HeightService;
let asked: string[] = [];
const points = { stick_bottom: { x: 0.3, y: 0.9 }, stick_top: { x: 0.3, y: 0.4 }, tree_base: { x: 0.6, y: 0.9 }, tree_top: { x: 0.6, y: 0.65 } };

beforeAll(async () => {
  await resetDatabase();
  app = await bootApp();
  f = await loadFixtures();
  admin = await new Session(app, 'admin@tms.local').login();
  officer = await new Session(app, 'officer@tms.local').login();
  heights = app.get(HeightService);
  heights.read = async (_photo, _mime, label) => {
    asked.push(label);
    return { suitable: true, unsuitable_reason: '', points, confidence: 'medium', notes: 'Stick beside the tree.' };
  };
});
afterAll(async () => {
  (config as any).anthropicApiKey = null;
  await app.close();
});

async function treeWithPhoto(serial: string, yearLabel: string) {
  const sharp = (await import('sharp')).default;
  const jpeg = await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#4caf50' } }).jpeg().toBuffer();
  const p = treePayload(f, serial);
  await officer.post('/sync/batches', { device_id: officer.deviceId, operations: [createOp(p)] }).expect(200);
  const s = await officer
    .post('/media/upload-sessions', { media_id: randomUUID(), tree_id: p.id, observation_id: p.initial_observation.id, checksum_sha256: createHash('sha256').update(jpeg).digest('hex'), byte_size: jpeg.length, mime_type: 'image/jpeg', captured_at: new Date().toISOString() })
    .expect(201);
  const u = new URL(s.body.upload_url);
  await request(app.getHttpServer()).put(u.pathname + u.search).set('Content-Type', 'image/jpeg').send(jpeg).expect(200);
  await officer.post(`/media/${s.body.media.id}/complete`).expect(200);
  const [y] = await sql(`INSERT INTO planting_years (project_id, year_label) VALUES ($1, $2) ON CONFLICT (project_id, year_label) DO UPDATE SET year_label = EXCLUDED.year_label RETURNING id`, [f.projectId, yearLabel]);
  await sql('UPDATE trees SET planting_year_id = $1 WHERE id = $2', [y.id, p.id]);
  return p.id as string;
}

describe('tree height from a photo', () => {
  it('works the height out from the stick: tree length / stick length × stick height', () => {
    // On an 800×1000 photo the stick is 500 px and the tree 250 px: half the stick.
    expect(heightFrom(points, 800, 1000, 100)).toMatchObject({ stick: 500, tree: 250, cm: 50 });
    expect(heightFrom(points, 800, 1000, 91.44).cm).toBe(45.7);
  });

  it('is off without an Anthropic key and for non-admins', async () => {
    (config as any).anthropicApiKey = null;
    const id = await treeWithPhoto('801', '2026');
    expect((await admin.post(`/trees/${id}/height-estimates`, {}).expect(404)).body.code).toBe('HEIGHT_ESTIMATES_OFF');
    await officer.get('/height-estimates/status').expect(403);
  });

  it('uses 1 m for 2026 and 3 ft for 2025, and saves a reviewed estimate without touching measurements', async () => {
    (config as any).anthropicApiKey = 'test-key';
    asked = [];
    const t2026 = await treeWithPhoto('802', '2026');
    const t2025 = await treeWithPhoto('803', '2025');
    const e2026 = (await admin.post(`/trees/${t2026}/height-estimates`, {}).expect(201)).body;
    const e2025 = (await admin.post(`/trees/${t2025}/height-estimates`, {}).expect(201)).body;
    expect(asked).toEqual(['1 m (100 cm)', '3 ft (91.44 cm)']);
    expect(e2026).toMatchObject({ status: 'SUGGESTED', reference_length_cm: 100, suggested_height_cm: 50, confidence: 'medium', image_width: 800, image_height: 1000 });
    expect(e2025).toMatchObject({ reference_length_cm: 91.44, suggested_height_cm: 45.7 });

    // The reviewer moves the tree's top: 300 px of a 500 px stick, so 60 cm.
    const moved = { ...points, tree_top: { x: 0.6, y: 0.6 } };
    const saved = (await admin.post(`/height-estimates/${e2026.id}/confirm`, { points: moved }).expect(200)).body;
    expect(saved).toMatchObject({ status: 'CONFIRMED', confirmed_height_cm: 60, suggested_height_cm: 50, reviewed_by_name: 'Ada Administrator' });
    expect(saved.suggested_points).toEqual(points);
    expect(saved.method_note).toMatch(/1 m \(100 cm\) reference stick; points suggested by AI and adjusted and checked by Ada Administrator/);
    await admin.post(`/height-estimates/${e2026.id}/confirm`, {}).expect(400);
    // Field measurements are untouched.
    expect((await sql('SELECT height_cm FROM tree_observations WHERE tree_id = $1', [t2026]))[0].height_cm).toBeNull();

    await admin.post(`/height-estimates/${e2025.id}/discard`).expect(200);
    expect((await admin.get(`/trees/${t2025}/height-estimates`).expect(200)).body).toEqual([]);
    expect((await admin.get(`/trees/${t2026}/height-estimates`).expect(200)).body).toHaveLength(1);
  });

  it('lets an administrator mark the points by hand, free and without any key (#118)', async () => {
    (config as any).anthropicApiKey = null;
    asked = [];
    expect((await admin.get('/height-estimates/status').expect(200)).body).toMatchObject({ enabled: true, ai: false });
    const id = await treeWithPhoto('806', '2026');
    const e = (await admin.post(`/trees/${id}/height-estimates`, { method: 'manual' }).expect(201)).body;
    expect(e).toMatchObject({ status: 'SUGGESTED', model: null, suggested_height_cm: null, reference_length_cm: 100 });
    const saved = (await admin.post(`/height-estimates/${e.id}/confirm`, { points }).expect(200)).body;
    expect(saved).toMatchObject({ status: 'CONFIRMED', confirmed_height_cm: 50 });
    expect(saved.method_note).toMatch(/points marked by Ada Administrator/);
    expect(asked).toEqual([]);
    (config as any).anthropicApiKey = 'test-key';
  });

  it('flags unsuitable photos instead of giving a height, and refuses years without a stick', async () => {
    heights.read = async () => ({ suitable: false, unsuitable_reason: 'The top of the tree is cut off.', points, confidence: 'low', notes: '' });
    const id = await treeWithPhoto('804', '2026');
    const e = (await admin.post(`/trees/${id}/height-estimates`, {}).expect(201)).body;
    expect(e).toMatchObject({ status: 'UNSUITABLE', unsuitable_reason: 'The top of the tree is cut off.' });
    const other = await treeWithPhoto('805', '2024');
    expect((await admin.post(`/trees/${other}/height-estimates`, {}).expect(400)).body.code).toBe('NO_REFERENCE_STICK');
  });
});
