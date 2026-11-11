// The harness first: it points the app's config at the test database before config is loaded.
import { bootApp, PASSWORD, resetDatabase, Session, sql } from './harness';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createOp, Fixtures, loadFixtures, treePayload } from './fixtures';

let app: INestApplication;
let f: Fixtures;
let admin: Session;
beforeAll(async () => {
  await resetDatabase();
  app = await bootApp();
  f = await loadFixtures();
  admin = await new Session(app, 'admin@tms.local').login();
});
afterAll(async () => {
  await app.close();
});

const del = (id: string, body: Record<string, unknown>) => admin.post(`/users/${id}/delete`, body);
const signIn = (login: string) => request(app.getHttpServer()).post('/api/v1/auth/login').send({ login, password: PASSWORD });

describe('permanently deleting a user', () => {
  it('needs DELETE typed and the admin’s password, and never deletes yourself', async () => {
    const [grace] = await sql(`SELECT id FROM users WHERE email = 'officer2@tms.local'`);
    const [me] = await sql(`SELECT id FROM users WHERE email = 'admin@tms.local'`);
    expect((await del(grace.id, { confirm: 'yes', password: PASSWORD }).expect(400)).body.code).toBe('CONFIRMATION_REQUIRED');
    expect((await del(grace.id, { confirm: 'DELETE', password: 'wrong' }).expect(401)).body.code).toBe('PASSWORD_INCORRECT');
    expect((await del(me.id, { confirm: 'DELETE', password: PASSWORD }).expect(400)).body.code).toBe('SELF_DELETE');
  });

  it('removes a user with no records completely', async () => {
    await signIn('officer2@tms.local').expect(200);
    const [grace] = await sql(`SELECT id FROM users WHERE email = 'officer2@tms.local'`);
    expect((await del(grace.id, { confirm: 'DELETE', password: PASSWORD }).expect(200)).body).toEqual({ id: grace.id, mode: 'removed' });
    expect(await sql('SELECT id FROM users WHERE id = $1', [grace.id])).toEqual([]);
    await signIn('officer2@tms.local').expect(401);
    expect((await admin.get('/users').expect(200)).body.some((u: any) => u.id === grace.id)).toBe(false);
  });

  it('keeps the trees of a user who collected data and erases the person', async () => {
    const officer = await new Session(app, 'officer@tms.local').login();
    const p = treePayload(f, '777');
    await officer.post('/sync/batches', { device_id: officer.deviceId, operations: [createOp(p)] }).expect(200);
    const id = f.officerId;
    // An officer's trees: the Field activity link opens this list.
    expect((await admin.get(`/trees?created_by=${id}`).expect(200)).body.total).toBe(1);

    expect((await del(id, { confirm: 'DELETE', password: PASSWORD }).expect(200)).body).toEqual({ id, mode: 'erased' });
    const [u] = await sql('SELECT full_name, email, phone, username, google_sub, active, deleted_at FROM users WHERE id = $1', [id]);
    expect(u).toMatchObject({ full_name: 'Deleted user', email: null, phone: null, google_sub: null, active: false });
    expect(u.username).toMatch(/^deleted-/);
    expect(u.deleted_at).toBeTruthy();
    // The tree stays, under "Deleted user"; the person can no longer sign in by any of their old identifiers.
    const tree = (await admin.get(`/trees/${p.id}`).expect(200)).body;
    expect(tree.created_by_name).toBe('Deleted user');
    await signIn('officer@tms.local').expect(401);
    await signIn('femi').expect(401);
    await signIn('08030000001').expect(401);
    expect((await admin.get('/users').expect(200)).body.some((x: any) => x.id === id)).toBe(false);
    // Their sessions ended, and audit entries about the account no longer hold their details.
    expect((await sql(`SELECT count(*)::int AS n FROM refresh_sessions WHERE user_id = $1`, [id]))[0].n).toBe(0);
    expect((await sql(`SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'user' AND entity_id = $1 AND (before IS NOT NULL OR after IS NOT NULL)`, [id]))[0].n).toBe(0);
    expect((await sql(`SELECT metadata FROM audit_logs WHERE action = 'user.delete' AND entity_id = $1`, [id]))[0].metadata).toEqual({ mode: 'erased' });
    // Deleting again: not found.
    await del(id, { confirm: 'DELETE', password: PASSWORD }).expect(404);
  });
});
