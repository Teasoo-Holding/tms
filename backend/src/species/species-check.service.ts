import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth.decorators';
import { AppError, badRequest, notFound } from '../common/errors';
import { config } from '../config';
import { Db } from '../database/db.service';
import { OBJECT_STORAGE, ObjectStorage } from '../media/storage';
import { runOperation } from '../trees/operation-runner';
import { TreesService } from '../trees/trees.service';
import { compare, identify, PlantNetQuotaError, PlantNetResult, speciesKey } from './plantnet';

/** Only one server checks at a time (see migration 001 for the other lock). */
const LOCK = 7381002;
const EVERY_MS = 15 * 60 * 1000;
/** Photos synced in this many days can be sampled. */
const SAMPLE_WINDOW_DAYS = 14;
const BATCH = 40;

export type Identify = (photo: Buffer, mimeType: string) => Promise<{ results: PlantNetResult[]; remaining: number | null }>;

/**
 * Species check (#101): a random sample of registration photos, spread through the day within Pl@ntNet's daily
 * free quota, is compared with the species the officer chose. Clear disagreements wait for an administrator.
 */
@Injectable()
export class SpeciesCheckService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SpeciesCheck');
  private timer?: NodeJS.Timeout;
  private quotaDay: string | null = null;
  lastRunAt: Date | null = null;
  lastRemaining: number | null = null;
  /** Replaced in tests. */
  identify: Identify = (photo, mime) => identify(config.plantnetApiKey!, photo, mime);

  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly trees: TreesService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  get enabled() {
    return !!config.plantnetApiKey;
  }

  onModuleInit() {
    if (!this.enabled || process.env.JEST_WORKER_ID) return;
    this.timer = setInterval(() => void this.run().catch((e) => this.log.warn(`run failed: ${e.message}`)), EVERY_MS);
    setTimeout(() => void this.run().catch(() => undefined), 60_000).unref();
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Checks already made today (UTC: Pl@ntNet's quota day). */
  async usedToday() {
    const r = await this.db.one(this.db, `SELECT count(*)::int AS n FROM species_checks WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`);
    return r?.n ?? 0;
  }

  /** How many checks may run now: the daily limit, spread evenly through the day. */
  async allowance(now = new Date()) {
    const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const due = Math.floor((config.speciesCheckDailyLimit * Math.min(1440, minutes + 15)) / 1440);
    return Math.max(0, Math.min(BATCH, due - (await this.usedToday())));
  }

  /** One round: picks unchecked registration photos at random and checks them. Returns how many were checked. */
  async run(now = new Date()): Promise<number> {
    if (!this.enabled) return 0;
    const today = now.toISOString().slice(0, 10);
    if (this.quotaDay === today) return 0;
    const client = await this.db.pool.connect();
    try {
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK]);
      if (!rows[0].ok) return 0;
      try {
        this.lastRunAt = now;
        const n = await this.allowance(now);
        if (!n) return 0;
        const candidates = await this.db.query(
          `SELECT m.id AS media_id, m.object_key, m.mime_type, t.id AS tree_id, t.project_id, o.recorded_by, t.species_id, sp.scientific_name
             FROM tree_media m
             JOIN tree_observations o ON o.id = m.observation_id AND o.is_initial
             JOIN trees t ON t.id = m.tree_id AND t.record_state = 'ACTIVE'
             JOIN tree_species sp ON sp.id = t.species_id
            WHERE m.upload_state = 'VERIFIED' AND m.object_key IS NOT NULL
              AND m.created_at >= now() - make_interval(days => $1)
              AND NOT EXISTS (SELECT 1 FROM species_checks c WHERE c.media_id = m.id)
            ORDER BY random() LIMIT $2`,
          [SAMPLE_WINDOW_DAYS, n],
        );
        let done = 0;
        for (const c of candidates.rows) {
          const ok = await this.checkOne(c);
          if (ok === 'quota') {
            this.quotaDay = today;
            break;
          }
          done++;
        }
        return done;
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK]);
      }
    } finally {
      client.release();
    }
  }

  private async checkOne(c: any): Promise<'done' | 'failed' | 'quota'> {
    const row = await this.db.one(
      this.db,
      `INSERT INTO species_checks (media_id, tree_id, project_id, recorded_by, claimed_species_id) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (media_id) DO NOTHING RETURNING id`,
      [c.media_id, c.tree_id, c.project_id, c.recorded_by, c.species_id],
    );
    if (!row) return 'done';
    try {
      const photo = await this.storage.getObject(c.object_key);
      const { results, remaining } = await this.identify(photo, c.mime_type ?? 'image/jpeg');
      this.lastRemaining = remaining;
      const { verdict, claimedScore, top } = compare(c.scientific_name, results);
      // The best suggestion that is an active TMS species other than the officer's.
      const species = await this.db.query(`SELECT id, scientific_name FROM tree_species WHERE active AND id <> $1`, [c.species_id]);
      const byKey = new Map(species.rows.map((s: any) => [speciesKey(s.scientific_name), s.id]));
      const suggestion = results.find((r) => byKey.has(speciesKey(r.name)));
      await this.db.query(
        `UPDATE species_checks SET status = 'DONE', verdict = $2, claimed_score = $3, top_name = $4, top_score = $5,
                suggested_species_id = $6, suggested_score = $7, results = $8, checked_at = now(),
                review_state = CASE WHEN $2 = 'DISAGREE' THEN 'OPEN' END
          WHERE id = $1`,
        [row.id, verdict, round(claimedScore), top?.name ?? null, top ? round(top.score) : null,
          suggestion ? byKey.get(speciesKey(suggestion.name)) : null, suggestion ? round(suggestion.score) : null, JSON.stringify(results.slice(0, 5))],
      );
      return 'done';
    } catch (e: any) {
      if (e instanceof PlantNetQuotaError) {
        // Not counted against today's sample; tried again tomorrow.
        await this.db.query('DELETE FROM species_checks WHERE id = $1', [row.id]);
        return 'quota';
      }
      await this.db.query(`UPDATE species_checks SET status = 'FAILED', failure_reason = $2, checked_at = now() WHERE id = $1`, [row.id, String(e.message).slice(0, 300)]);
      return 'failed';
    }
  }

  // ------------------------------------------------------------------ review

  async status() {
    return {
      enabled: this.enabled,
      daily_limit: config.speciesCheckDailyLimit,
      checked_today: await this.usedToday(),
      quota_reached_today: this.quotaDay === new Date().toISOString().slice(0, 10),
      remaining_reported: this.lastRemaining,
      last_run_at: this.lastRunAt,
    };
  }

  async list(f: { project_id?: string; state: 'open' | 'reviewed' | 'all'; verdict?: string; limit: number; offset: number }) {
    const where = [`c.status = 'DONE'`];
    const p: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      p.push(v);
      where.push(sql.replace('?', `$${p.length}`));
    };
    if (f.project_id) add('c.project_id = ?', f.project_id);
    if (f.state === 'open') where.push(`c.review_state = 'OPEN'`);
    if (f.state === 'reviewed') where.push(`c.review_state IN ('KEPT', 'CORRECTED')`);
    if (f.verdict) add('c.verdict = ?', f.verdict);
    const w = where.join(' AND ');
    const [{ total }] = (await this.db.query(`SELECT count(*)::int AS total FROM species_checks c WHERE ${w}`, p)).rows;
    const { rows } = await this.db.query(
      `SELECT c.id, c.media_id, c.tree_id, t.physical_tree_id, c.project_id, pr.name AS project_name, c.verdict, c.review_state,
              c.claimed_score::float8 AS claimed_score, c.top_name, c.top_score::float8 AS top_score, c.suggested_score::float8 AS suggested_score,
              c.results, c.created_at, c.checked_at, c.reviewed_at,
              c.claimed_species_id, cs.scientific_name AS claimed_scientific_name, cs.common_name AS claimed_common_name,
              c.suggested_species_id, ss.scientific_name AS suggested_scientific_name, ss.common_name AS suggested_common_name,
              t.species_id AS current_species_id, cur.scientific_name AS current_scientific_name, cur.common_name AS current_common_name,
              u.full_name AS recorded_by_name, rv.full_name AS reviewed_by_name
         FROM species_checks c
         JOIN trees t ON t.id = c.tree_id
         JOIN projects pr ON pr.id = c.project_id
         JOIN tree_species cs ON cs.id = c.claimed_species_id
         JOIN tree_species cur ON cur.id = t.species_id
         LEFT JOIN tree_species ss ON ss.id = c.suggested_species_id
         LEFT JOIN users u ON u.id = c.recorded_by
         LEFT JOIN users rv ON rv.id = c.reviewed_by
        WHERE ${w}
        ORDER BY c.checked_at DESC NULLS LAST
        LIMIT $${p.length + 1} OFFSET $${p.length + 2}`,
      [...p, f.limit, f.offset],
    );
    return { total, limit: f.limit, offset: f.offset, items: rows };
  }

  /** "keep": the officer was right. "correct": change the tree's species (through the normal tree edit, so phones sync it). */
  async review(user: AuthUser, id: string, action: 'keep' | 'correct', speciesId?: string) {
    const check = await this.db.one(this.db, 'SELECT * FROM species_checks WHERE id = $1', [id]);
    if (!check) throw notFound('Species check not found.');
    if (check.status !== 'DONE') throw badRequest('CHECK_NOT_DONE', 'This photo has not been checked yet.');
    if (action === 'correct' && !speciesId) throw badRequest('SPECIES_REQUIRED', 'Choose the species to change to.');
    return this.db.tx(async (tx) => {
      if (action === 'correct') {
        const tree = await this.db.one(tx, 'SELECT revision, species_id FROM trees WHERE id = $1', [check.tree_id]);
        if (tree && tree.species_id !== speciesId) {
          const result = await runOperation(tx, () =>
            this.trees.updateTree(tx, user, { id: check.tree_id, base_revision: tree.revision, changes: { species_id: speciesId } }, { deviceId: null, operationId: null }),
          );
          if (result.status !== 'ACCEPTED') throw new AppError(409, (result as any).code ?? 'UPDATE_REJECTED', (result as any).message ?? 'The tree could not be updated.');
        }
      }
      const updated = await this.db.one(
        tx,
        `UPDATE species_checks SET review_state = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1 RETURNING id, review_state`,
        [id, action === 'keep' ? 'KEPT' : 'CORRECTED', user.id],
      );
      await this.audit.record(
        { actorId: user.id, action: `species_check.${action}`, entityType: 'tree', entityId: check.tree_id, projectId: check.project_id, metadata: { check_id: id, species_id: speciesId ?? null } },
        tx,
      );
      return updated;
    });
  }

  /**
   * Agreement per officer and per species: checked photos, agreements, disagreements and unsure results.
   * agreement_rate = agree / (agree + disagree); reviews refine it ("kept" means the officer was right).
   */
  async agreement(projectId?: string) {
    const p = [projectId ?? null];
    const counts = `count(*)::int AS checked,
      count(*) FILTER (WHERE c.verdict = 'AGREE')::int AS agree,
      count(*) FILTER (WHERE c.verdict = 'DISAGREE')::int AS disagree,
      count(*) FILTER (WHERE c.verdict = 'UNSURE')::int AS unsure,
      count(*) FILTER (WHERE c.review_state = 'OPEN')::int AS to_review,
      count(*) FILTER (WHERE c.review_state = 'KEPT')::int AS kept,
      count(*) FILTER (WHERE c.review_state = 'CORRECTED')::int AS corrected`;
    const base = `FROM species_checks c WHERE c.status = 'DONE' AND ($1::uuid IS NULL OR c.project_id = $1)`;
    const rate = (r: any) => ({ ...r, agreement_rate: r.agree + r.disagree ? Math.round((r.agree / (r.agree + r.disagree)) * 1000) / 1000 : null });
    const [totals] = (await this.db.query(`SELECT ${counts} ${base}`, p)).rows;
    const officers = (await this.db.query(
      `SELECT c.recorded_by AS user_id, COALESCE(u.full_name, 'Unknown') AS name, ${counts}
         FROM species_checks c LEFT JOIN users u ON u.id = c.recorded_by
        WHERE c.status = 'DONE' AND ($1::uuid IS NULL OR c.project_id = $1)
        GROUP BY c.recorded_by, u.full_name ORDER BY checked DESC`, p)).rows;
    const species = (await this.db.query(
      `SELECT c.claimed_species_id AS species_id, sp.scientific_name, sp.common_name, ${counts}
         FROM species_checks c JOIN tree_species sp ON sp.id = c.claimed_species_id
        WHERE c.status = 'DONE' AND ($1::uuid IS NULL OR c.project_id = $1)
        GROUP BY c.claimed_species_id, sp.scientific_name, sp.common_name ORDER BY checked DESC`, p)).rows;
    return { totals: rate(totals), by_officer: officers.map(rate), by_species: species.map(rate) };
  }
}

const round = (v: number) => Math.round(v * 10000) / 10000;
