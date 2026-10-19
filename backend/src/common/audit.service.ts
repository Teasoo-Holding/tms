import { Injectable } from '@nestjs/common';
import { Db, Queryable } from '../database/db.service';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: Db) {}

  /** Pass the transaction client so the audit row commits or rolls back with the change. */
  async record(entry: AuditEntry, q: Queryable = this.db) {
    await q.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, project_id, before, after, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.actorId,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.projectId ?? null,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
        entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
      ],
    );
  }
}
