import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { copyObjects } from '../../src/media/copy-objects';
import { FallbackStorage, LocalStorage, ObjectStorage, StoredObjectInfo } from '../../src/media/storage';

/** An in-memory store whose signed URLs name the store, so a test can tell which one signed. */
class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  constructor(readonly name: string) {}
  async createUploadUrl(key: string) {
    return { url: `mem://${this.name}/upload/${key}`, headers: {} };
  }
  async createDownloadUrl(key: string) {
    return `mem://${this.name}/${key}`;
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
  async inspect(key: string): Promise<StoredObjectInfo> {
    const o = this.objects.get(key);
    return o ? { exists: true, byteSize: o.body.length, sha256: this.name } : { exists: false };
  }
  async getObject(key: string) {
    const o = this.objects.get(key);
    if (!o) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    return o.body;
  }
  async putObject(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  async deleteObjects(keys: string[]) {
    keys.forEach((k) => this.objects.delete(k));
  }
}

describe('storage with a legacy read fallback', () => {
  let primary: MemoryStorage;
  let legacy: MemoryStorage;
  let store: FallbackStorage;
  beforeEach(() => {
    primary = new MemoryStorage('r2');
    legacy = new MemoryStorage('neon');
    store = new FallbackStorage(primary, legacy);
    legacy.objects.set('old.jpg', { body: Buffer.from('old photo'), contentType: 'image/jpeg' });
    primary.objects.set('new.jpg', { body: Buffer.from('new photo'), contentType: 'image/jpeg' });
  });

  it('reads, inspects and signs objects not yet copied from the legacy store', async () => {
    expect((await store.getObject('old.jpg')).toString()).toBe('old photo');
    expect(await store.inspect('old.jpg')).toMatchObject({ exists: true, sha256: 'neon' });
    expect(await store.createDownloadUrl('old.jpg')).toBe('mem://neon/old.jpg');
    expect(await store.exists('old.jpg')).toBe(true);
  });

  it('prefers the primary store once an object is there', async () => {
    expect((await store.getObject('new.jpg')).toString()).toBe('new photo');
    expect(await store.createDownloadUrl('new.jpg')).toBe('mem://r2/new.jpg');
    legacy.objects.set('new.jpg', { body: Buffer.from('stale'), contentType: 'image/jpeg' });
    expect((await store.getObject('new.jpg')).toString()).toBe('new photo');
    expect(await store.inspect('new.jpg')).toMatchObject({ sha256: 'r2' });
  });

  it('sends uploads and writes to the primary store only', async () => {
    expect((await store.createUploadUrl('up.jpg', 'image/jpeg', 10, 'a'.repeat(64))).url).toBe('mem://r2/upload/up.jpg');
    await store.putObject('thumb.jpg', Buffer.from('t'), 'image/jpeg');
    expect(primary.objects.has('thumb.jpg')).toBe(true);
    expect(legacy.objects.has('thumb.jpg')).toBe(false);
  });

  it('reports missing objects in neither store as missing, and signs them from the primary store', async () => {
    expect(await store.inspect('none.jpg')).toEqual({ exists: false });
    expect(await store.exists('none.jpg')).toBe(false);
    await expect(store.getObject('none.jpg')).rejects.toMatchObject({ name: 'NoSuchKey' });
    expect(await store.createDownloadUrl('none.jpg')).toBe('mem://r2/none.jpg');
  });

  it('deletes from both stores', async () => {
    legacy.objects.set('new.jpg', { body: Buffer.from('x'), contentType: 'image/jpeg' });
    await store.deleteObjects(['new.jpg', 'old.jpg']);
    expect(primary.objects.size).toBe(0);
    expect(legacy.objects.size).toBe(0);
  });

  it('falls back from the local driver too (a missing file is "not found")', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-storage-'));
    try {
      const local = new LocalStorage(root);
      const viaLocal = new FallbackStorage(local, legacy);
      expect((await viaLocal.getObject('old.jpg')).toString()).toBe('old photo');
      expect(await viaLocal.createDownloadUrl('old.jpg')).toBe('mem://neon/old.jpg');
      await local.putObject('here.jpg', Buffer.from('local'));
      expect((await viaLocal.getObject('here.jpg')).toString()).toBe('local');
      expect(await viaLocal.createDownloadUrl('here.jpg')).toContain('/media/local/download?');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('copying objects to the new store', () => {
  const objects = [
    { key: 'a.jpg', contentType: 'image/jpeg' },
    { key: 'a.jpg.thumb.jpg', contentType: 'image/jpeg' },
    { key: 'b.png', contentType: 'image/png' },
    { key: 'never-uploaded.jpg', contentType: 'image/jpeg' },
  ];
  let from: MemoryStorage;
  let to: MemoryStorage;
  beforeEach(() => {
    from = new MemoryStorage('neon');
    to = new MemoryStorage('r2');
    for (const o of objects.slice(0, 3)) from.objects.set(o.key, { body: Buffer.from(o.key), contentType: 'application/octet-stream' });
    to.objects.set('b.png', { body: Buffer.from('b.png'), contentType: 'image/png' });
  });

  it('a dry run counts what it would copy and writes nothing', async () => {
    const r = await copyObjects(objects, from, to, { dryRun: true });
    expect(r).toMatchObject({ total: 4, copied: 2, skipped: 1, missing: ['never-uploaded.jpg'], failed: [] });
    expect([...to.objects.keys()]).toEqual(['b.png']);
  });

  it('copies what is missing with its content type, then has nothing left to do', async () => {
    const lines: string[] = [];
    const r = await copyObjects(objects, from, to, { log: (l) => lines.push(l) });
    expect(r).toMatchObject({ copied: 2, skipped: 1, missing: ['never-uploaded.jpg'], failed: [] });
    expect(to.objects.get('a.jpg')).toEqual({ body: Buffer.from('a.jpg'), contentType: 'image/jpeg' });
    expect(lines[lines.length - 1]).toMatch(/^4 of 4: 2 copied/);
    const again = await copyObjects(objects, from, to);
    expect(again).toMatchObject({ copied: 0, skipped: 3, missing: ['never-uploaded.jpg'] });
  });

  it('records failures and carries on', async () => {
    from.getObject = async (key: string) => {
      if (key === 'a.jpg') throw new Error('connection reset');
      return Buffer.from(key);
    };
    const r = await copyObjects(objects, from, to);
    expect(r.failed).toEqual([{ key: 'a.jpg', error: 'connection reset' }]);
    expect(to.objects.has('a.jpg.thumb.jpg')).toBe(true);
  });
});
