import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { config } from '../config';

// Return DATE columns as 'YYYY-MM-DD' strings rather than local-midnight Date objects.
types.setTypeParser(1082, (v) => v);
// bigint counts are safe as numbers at Phase 1 volumes.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

export const CHANGE_FEED_LOCK = 7381001;

export interface Queryable {
  query<T extends QueryResultRow = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
  }

  query<T extends QueryResultRow = any>(text: string, params?: unknown[]) {
    return this.pool.query<T>(text, params as any[]);
  }

  async one<T extends QueryResultRow = any>(q: Queryable, text: string, params?: unknown[]): Promise<T | null> {
    const { rows } = await q.query<T>(text, params);
    return rows[0] ?? null;
  }

  /**
   * Runs fn inside a transaction; rolls back on any thrown error. Write transactions first take the
   * change-feed lock (see migration 001) so change_log sequence numbers become visible in commit order.
   */
  async tx<T>(fn: (client: PoolClient) => Promise<T>, isolation = 'READ COMMITTED', readOnly = false): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}${readOnly ? ' READ ONLY' : ''}`);
      if (!readOnly) await client.query(`SELECT pg_advisory_xact_lock(${CHANGE_FEED_LOCK})`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

export function isUniqueViolation(err: any, constraint?: string): boolean {
  return err?.code === '23505' && (!constraint || err.constraint === constraint);
}
