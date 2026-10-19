import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { badRequest, notFound } from '../common/errors';
import { isoDate, parse, shortCode } from '../common/validation';
import { Db, isUniqueViolation } from '../database/db.service';
import { IdScheme, validateScheme, COMPONENT_TYPES, SCOPE_DIMENSIONS } from '../domain/tree-id';

const ProjectBody = z.object({
  name: z.string().trim().min(1).max(200),
  short_code: shortCode,
  description: z.string().max(4000).nullish(),
  location: z.string().max(500).nullish(),
  start_date: isoDate.nullish(),
  end_date: isoDate.nullish(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']).default('DRAFT'),
  physical_id_uniqueness: z.enum(['GLOBAL', 'PROJECT']),
});
// Uniqueness scope cannot change once trees exist, so it is excluded from updates.
const ProjectPatch = ProjectBody.omit({ physical_id_uniqueness: true }).partial();

const PlantingYearBody = z.object({
  year_label: z.string().trim().regex(/^[A-Za-z0-9]{1,16}$/, 'Use 1–16 letters or digits'),
  start_date: isoDate.nullish(),
  end_date: isoDate.nullish(),
  active: z.boolean().default(true),
});

const SchemeBody = z.object({
  components: z
    .array(z.object({ type: z.enum(COMPONENT_TYPES), required: z.boolean().default(true) }))
    .min(1)
    .max(6),
  separator: z.string().max(1),
  serial_width: z.number().int(),
  serial_uniqueness_scope: z.array(z.enum(SCOPE_DIMENSIONS)),
  active_from: z.string().datetime({ offset: true }).optional(),
});

@Controller()
export class ProjectsController {
  constructor(private readonly db: Db, private readonly access: AccessService, private readonly audit: AuditService) {}

  @Get('projects')
  async list(@CurrentUser() user: AuthUser) {
    const ids = await this.access.projectIds(user);
    const { rows } = await this.db.query(
      `SELECT p.*, (SELECT count(*) FROM trees t WHERE t.project_id = p.id AND t.record_state = 'ACTIVE') AS tree_count
         FROM projects p WHERE ($1::uuid[] IS NULL OR p.id = ANY($1)) ORDER BY p.name`,
      [ids],
    );
    return rows;
  }

  @Get('projects/:id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.assertProject(user, id);
    const project = await this.db.one(this.db, 'SELECT * FROM projects WHERE id = $1', [id]);
    if (!project) throw notFound('Project');
    const [years, schemes] = await Promise.all([
      this.db.query('SELECT * FROM planting_years WHERE project_id = $1 ORDER BY year_label', [id]),
      this.db.query('SELECT * FROM tree_id_schemes WHERE project_id = $1 ORDER BY version DESC', [id]),
    ]);
    return { ...project, planting_years: years.rows, tree_id_schemes: schemes.rows };
  }

  @Roles('ADMIN')
  @Post('projects')
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const b = parse(ProjectBody, body);
    return this.db.tx(async (tx) => {
      const project = await this.db
        .one(
          tx,
          `INSERT INTO projects (name, short_code, description, location, start_date, end_date, status, physical_id_uniqueness)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [b.name, b.short_code, b.description ?? null, b.location ?? null, b.start_date ?? null, b.end_date ?? null, b.status, b.physical_id_uniqueness],
        )
        .catch((e) => {
          if (isUniqueViolation(e)) throw badRequest('SHORT_CODE_TAKEN', 'Another project already uses this short code.');
          throw e;
        });
      await this.audit.record({ actorId: user.id, action: 'project.create', entityType: 'project', entityId: project!.id, projectId: project!.id, after: project }, tx);
      return project;
    });
  }

  @Roles('ADMIN')
  @Patch('projects/:id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(ProjectPatch, body);
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, 'SELECT * FROM projects WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw notFound('Project');
      const next = { ...before, ...b };
      const after = await this.db
        .one(
          tx,
          `UPDATE projects SET name = $2, short_code = $3, description = $4, location = $5, start_date = $6, end_date = $7,
                  status = $8, updated_at = now() WHERE id = $1 RETURNING *`,
          [id, next.name, next.short_code, next.description, next.location, next.start_date, next.end_date, next.status],
        )
        .catch((e) => {
          if (isUniqueViolation(e)) throw badRequest('SHORT_CODE_TAKEN', 'Another project already uses this short code.');
          throw e;
        });
      // A short-code change affects future IDs only; existing trees keep their registered physical IDs.
      await this.audit.record({ actorId: user.id, action: 'project.update', entityType: 'project', entityId: id, projectId: id, before, after }, tx);
      return after;
    });
  }

  @Roles('ADMIN')
  @Post('projects/:id/planting-years')
  async createYear(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) projectId: string, @Body() body: unknown) {
    const b = parse(PlantingYearBody, body);
    return this.db.tx(async (tx) => {
      if (!(await this.db.one(tx, 'SELECT id FROM projects WHERE id = $1', [projectId]))) throw notFound('Project');
      const year = await this.db
        .one(
          tx,
          `INSERT INTO planting_years (project_id, year_label, start_date, end_date, active) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [projectId, b.year_label, b.start_date ?? null, b.end_date ?? null, b.active],
        )
        .catch((e) => {
          if (isUniqueViolation(e)) throw badRequest('YEAR_EXISTS', 'This planting year already exists for the project.');
          throw e;
        });
      await this.audit.record({ actorId: user.id, action: 'planting_year.create', entityType: 'planting_year', entityId: year!.id, projectId, after: year }, tx);
      return year;
    });
  }

  @Roles('ADMIN')
  @Patch('planting-years/:id')
  async updateYear(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    // The label is part of registered IDs; it is fixed once created.
    const b = parse(PlantingYearBody.omit({ year_label: true }).partial(), body);
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, 'SELECT * FROM planting_years WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw notFound('Planting year');
      const n = { ...before, ...b };
      const after = await this.db.one(
        tx,
        'UPDATE planting_years SET start_date = $2, end_date = $3, active = $4, updated_at = now() WHERE id = $1 RETURNING *',
        [id, n.start_date, n.end_date, n.active],
      );
      await this.audit.record({ actorId: user.id, action: 'planting_year.update', entityType: 'planting_year', entityId: id, projectId: before.project_id, before, after }, tx);
      return after;
    });
  }

  /** Creates a new ID format version; it becomes current for new registrations. Existing IDs are untouched. */
  @Roles('ADMIN')
  @Post('projects/:id/tree-id-schemes')
  async createScheme(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) projectId: string, @Body() body: unknown) {
    const b = parse(SchemeBody, body);
    const scheme: IdScheme = {
      separator: b.separator,
      serialWidth: b.serial_width,
      components: b.components,
      serialUniquenessScope: b.serial_uniqueness_scope,
    };
    const problems = validateScheme(scheme);
    if (problems.length) throw badRequest('SCHEME_INVALID', 'The ID format is not valid.', problems);
    return this.db.tx(async (tx) => {
      if (!(await this.db.one(tx, 'SELECT id FROM projects WHERE id = $1 FOR UPDATE', [projectId]))) throw notFound('Project');
      const { rows } = await tx.query('SELECT COALESCE(max(version), 0) + 1 AS v FROM tree_id_schemes WHERE project_id = $1', [projectId]);
      await tx.query('UPDATE tree_id_schemes SET active = false, updated_at = now() WHERE project_id = $1 AND active', [projectId]);
      const created = await this.db.one(
        tx,
        `INSERT INTO tree_id_schemes (project_id, version, component_definition, separator, serial_width, serial_uniqueness_scope, active_from, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()), $8) RETURNING *`,
        [projectId, rows[0].v, JSON.stringify(b.components), b.separator, b.serial_width, JSON.stringify(b.serial_uniqueness_scope), b.active_from ?? null, user.id],
      );
      await this.audit.record({ actorId: user.id, action: 'tree_id_scheme.create', entityType: 'tree_id_scheme', entityId: created!.id, projectId, after: created }, tx);
      return created;
    });
  }
}
