import { Injectable } from '@nestjs/common';
import { Db, Queryable } from '../database/db.service';
import { AuthUser } from './auth.decorators';
import { forbidden } from './errors';

export interface AreaGrant {
  projectId: string;
  sectorId: string | null;
  subSectorId: string | null;
}

/**
 * Server-side project/area authorisation. Administrators see everything; field officers and
 * executives see only projects (and optionally sectors/sub-sectors) they are assigned to.
 */
@Injectable()
export class AccessService {
  constructor(private readonly db: Db) {}

  async grants(user: AuthUser, q: Queryable = this.db): Promise<AreaGrant[] | 'ALL'> {
    if (user.role === 'ADMIN') return 'ALL';
    const { rows } = await q.query(
      `SELECT a.project_id, a.sector_id, a.sub_sector_id
         FROM user_project_assignments a JOIN projects p ON p.id = a.project_id
        WHERE a.user_id = $1 AND a.active`,
      [user.id],
    );
    return rows.map((r) => ({ projectId: r.project_id, sectorId: r.sector_id, subSectorId: r.sub_sector_id }));
  }

  /** Project IDs the user may read, or null meaning unrestricted. */
  async projectIds(user: AuthUser, q: Queryable = this.db): Promise<string[] | null> {
    const g = await this.grants(user, q);
    return g === 'ALL' ? null : [...new Set(g.map((x) => x.projectId))];
  }

  async assertProject(user: AuthUser, projectId: string, q: Queryable = this.db) {
    const ids = await this.projectIds(user, q);
    if (ids && !ids.includes(projectId)) throw forbidden('You are not assigned to this project.');
  }

  canAccessArea(grants: AreaGrant[] | 'ALL', projectId: string, sectorId: string, subSectorId: string): boolean {
    if (grants === 'ALL') return true;
    return grants.some(
      (g) =>
        g.projectId === projectId &&
        (g.sectorId === null || g.sectorId === sectorId) &&
        (g.subSectorId === null || g.subSectorId === subSectorId),
    );
  }

  async assertArea(user: AuthUser, projectId: string, sectorId: string, subSectorId: string, q: Queryable = this.db) {
    if (!this.canAccessArea(await this.grants(user, q), projectId, sectorId, subSectorId)) {
      throw forbidden('You are not assigned to this area.');
    }
  }

  /**
   * SQL fragment restricting a trees alias to the user's grants. Returns params to append.
   * Example: const f = access.treeFilter(grants, 't', params.length + 1)
   */
  treeFilter(grants: AreaGrant[] | 'ALL', alias: string, nextParam: number): { sql: string; params: unknown[] } {
    if (grants === 'ALL') return { sql: 'TRUE', params: [] };
    if (grants.length === 0) return { sql: 'FALSE', params: [] };
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const g of grants) {
      const parts = [`${alias}.project_id = $${nextParam + params.length}`];
      params.push(g.projectId);
      if (g.sectorId) {
        parts.push(`${alias}.sector_id = $${nextParam + params.length}`);
        params.push(g.sectorId);
      }
      if (g.subSectorId) {
        parts.push(`${alias}.sub_sector_id = $${nextParam + params.length}`);
        params.push(g.subSectorId);
      }
      clauses.push(`(${parts.join(' AND ')})`);
    }
    return { sql: `(${clauses.join(' OR ')})`, params };
  }
}
