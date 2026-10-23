import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { badRequest, notFound } from '../common/errors';
import { isoDate, parse, shortCode } from '../common/validation';
import { Db, isUniqueViolation } from '../database/db.service';
import { DEFAULT_SCHEME, IdScheme, retiredSchemeParts, validateScheme, COMPONENT_TYPES, SCOPE_DIMENSIONS } from '../domain/tree-id';
import { FIELD_TYPES } from '../domain/custom-fields';

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
    .array(z.object({ type: z.enum(COMPONENT_TYPES), required: z.boolean().default(true), value: z.string().trim().max(16).optional() }))
    .min(1)
    .max(8),
  separator: z.string().max(1),
  serial_width: z.number().int(),
  serial_uniqueness_scope: z.array(z.enum(SCOPE_DIMENSIONS)),
  active_from: z.string().datetime({ offset: true }).optional(),
  /** Retired: a project has one format for all vendors and years. Still parsed so a stale client gets a clear refusal. */
  vendor_id: z.string().uuid().nullish(),
  planting_year_id: z.string().uuid().nullish(),
});

const CustomFieldBody = z
  .object({
    applies_to: z.enum(['TREE', 'OBSERVATION']),
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lower-case letters, digits and underscores, starting with a letter').optional(),
    label: z.string().trim().min(1).max(100),
    field_type: z.enum(FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    required: z.boolean().default(false),
    sticky: z.boolean().default(false),
    help_text: z.string().trim().max(300).nullish(),
    sort_order: z.number().int().default(0),
    active: z.boolean().default(true),
  })
  .refine((b) => b.field_type !== 'SELECT' || b.options.length > 0, { message: 'A choice field needs at least one option', path: ['options'] });
// The key and type are fixed once created: stored values are keyed and typed by them.
const CustomFieldPatch = z.object({
  label: z.string().trim().min(1).max(100),
  options: z.array(z.string().trim().min(1).max(200)).max(100),
  required: z.boolean(),
  sticky: z.boolean(),
  help_text: z.string().trim().max(300).nullable(),
  sort_order: z.number().int(),
  active: z.boolean(),
}).partial();

/** "Nursery batch no." → "nursery_batch_no" */
function keyFromLabel(label: string) {
  const k = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40);
  return k || 'field';
}

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
    const [years, schemes, vendors] = await Promise.all([
      this.db.query('SELECT * FROM planting_years WHERE project_id = $1 ORDER BY year_label', [id]),
      this.db.query(
        `SELECT s.*, v.name AS vendor_name, v.short_code AS vendor_short_code, py.year_label
           FROM tree_id_schemes s LEFT JOIN vendors v ON v.id = s.vendor_id LEFT JOIN planting_years py ON py.id = s.planting_year_id
          WHERE s.project_id = $1 ORDER BY s.version DESC`,
        [id],
      ),
      this.db.query(
        `SELECT l.*, v.name AS vendor_name, v.short_code AS vendor_short_code
           FROM planting_year_vendors l JOIN vendors v ON v.id = l.vendor_id WHERE l.project_id = $1 ORDER BY v.name`,
        [id],
      ),
    ]);
    return { ...project, planting_years: years.rows, tree_id_schemes: schemes.rows, planting_year_vendors: vendors.rows };
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
      // Every project has one ID format from the start; the administrator can change it before trees are registered.
      await tx.query(
        `INSERT INTO tree_id_schemes (project_id, version, component_definition, separator, serial_width, serial_uniqueness_scope, created_by)
         VALUES ($1, 1, $2, $3, $4, $5, $6)`,
        [project!.id, JSON.stringify(DEFAULT_SCHEME.components), DEFAULT_SCHEME.separator, DEFAULT_SCHEME.serialWidth, JSON.stringify(DEFAULT_SCHEME.serialUniquenessScope), user.id],
      );
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

  /**
   * Creates a new version of the project's ID format; it becomes current for new registrations. Existing IDs are untouched.
   * One format per project: all vendors share one serial sequence per planting year, so formats are not set per vendor or year.
   */
  @Roles('ADMIN')
  @Post('projects/:id/tree-id-schemes')
  async createScheme(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) projectId: string, @Body() body: unknown) {
    const b = parse(SchemeBody, body);
    if (b.vendor_id) {
      throw badRequest('VENDOR_FORMAT_RETIRED', 'Tree ID formats are no longer set per vendor: all vendors on a project share one numbering per planting year. Leave out vendor_id.');
    }
    if (b.planting_year_id) {
      throw badRequest('YEAR_FORMAT_RETIRED', 'Tree ID formats are set once per project (the planting year is a part of the ID). Leave out planting_year_id.');
    }
    const scheme: IdScheme = {
      separator: b.separator,
      serialWidth: b.serial_width,
      components: b.components,
      serialUniquenessScope: b.serial_uniqueness_scope,
    };
    const retired = retiredSchemeParts(scheme);
    if (retired.length) {
      throw badRequest(
        'SCHEME_INVALID',
        'A tree ID can no longer include the vendor code or count tree numbers per vendor: all vendors on a project share one sequence per planting year.',
        retired,
      );
    }
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

  // ------------------------------------------------------------------ custom fields
  @Get('projects/:id/custom-fields')
  async customFields(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) projectId: string) {
    await this.access.assertProject(user, projectId);
    const { rows } = await this.db.query(
      'SELECT * FROM custom_field_definitions WHERE project_id = $1 ORDER BY applies_to, sort_order, label',
      [projectId],
    );
    return rows;
  }

  @Roles('ADMIN')
  @Post('projects/:id/custom-fields')
  async createCustomField(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) projectId: string, @Body() body: unknown) {
    const b = parse(CustomFieldBody, body);
    return this.db.tx(async (tx) => {
      if (!(await this.db.one(tx, 'SELECT id FROM projects WHERE id = $1', [projectId]))) throw notFound('Project');
      const created = await this.db
        .one(
          tx,
          `INSERT INTO custom_field_definitions (project_id, applies_to, key, label, field_type, options, required, sticky, help_text, sort_order, active, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
          [projectId, b.applies_to, b.key ?? keyFromLabel(b.label), b.label, b.field_type, JSON.stringify(b.options), b.required, b.sticky,
            b.help_text ?? null, b.sort_order, b.active, user.id],
        )
        .catch((e) => {
          if (isUniqueViolation(e)) throw badRequest('FIELD_EXISTS', 'A field with this name already exists. Choose a different name.');
          throw e;
        });
      await this.audit.record({ actorId: user.id, action: 'custom_field.create', entityType: 'custom_field', entityId: created!.id, projectId, after: created }, tx);
      return created;
    });
  }

  @Roles('ADMIN')
  @Patch('custom-fields/:id')
  async updateCustomField(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(CustomFieldPatch, body);
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, 'SELECT * FROM custom_field_definitions WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw notFound('Field');
      const n = { ...before, ...b };
      if (n.field_type === 'SELECT' && n.options.length === 0) throw badRequest('OPTIONS_REQUIRED', 'A choice field needs at least one option.');
      const after = await this.db.one(
        tx,
        `UPDATE custom_field_definitions SET label = $2, options = $3, required = $4, sticky = $5, help_text = $6, sort_order = $7,
                active = $8, updated_at = now() WHERE id = $1 RETURNING *`,
        [id, n.label, JSON.stringify(n.options), n.required, n.sticky, n.help_text, n.sort_order, n.active],
      );
      await this.audit.record({ actorId: user.id, action: 'custom_field.update', entityType: 'custom_field', entityId: id, projectId: before.project_id, before, after }, tx);
      return after;
    });
  }

  /** Retires a legacy vendor- or year-specific format (none stay active since migration 007; the project format cannot be retired). */
  @Roles('ADMIN')
  @Post('tree-id-schemes/:id/retire')
  async retireScheme(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, 'SELECT * FROM tree_id_schemes WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw notFound('ID format');
      if (!before.vendor_id && !before.planting_year_id) throw badRequest('DEFAULT_FORMAT', 'The project default format can be replaced but not retired.');
      const after = await this.db.one(tx, 'UPDATE tree_id_schemes SET active = false, updated_at = now() WHERE id = $1 RETURNING *', [id]);
      await this.audit.record({ actorId: user.id, action: 'tree_id_scheme.retire', entityType: 'tree_id_scheme', entityId: id, projectId: before.project_id, before, after }, tx);
      return after;
    });
  }

  // ------------------------------------------------------------------ vendors per planting year
  /** A vendor plants across the whole surveyed area of a planting year. */
  @Roles('ADMIN')
  @Post('planting-years/:id/vendors')
  async linkVendor(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) yearId: string, @Body() body: unknown) {
    const b = parse(z.object({ vendor_id: z.string().uuid() }), body);
    return this.db.tx(async (tx) => {
      const year = await this.db.one(tx, 'SELECT id, project_id FROM planting_years WHERE id = $1', [yearId]);
      if (!year) throw notFound('Planting year');
      if (!(await this.db.one(tx, 'SELECT id FROM vendors WHERE id = $1', [b.vendor_id]))) throw notFound('Vendor');
      const row = await this.db.one(
        tx,
        `INSERT INTO planting_year_vendors (project_id, planting_year_id, vendor_id) VALUES ($1, $2, $3)
         ON CONFLICT (planting_year_id, vendor_id) DO UPDATE SET active = true, updated_at = now() RETURNING *`,
        [year.project_id, yearId, b.vendor_id],
      );
      await this.audit.record({ actorId: user.id, action: 'planting_year_vendor.link', entityType: 'planting_year_vendor', entityId: row!.id, projectId: year.project_id, after: row }, tx);
      return row;
    });
  }

  @Roles('ADMIN')
  @Post('planting-year-vendors/:id/unlink')
  async unlinkVendor(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, 'SELECT * FROM planting_year_vendors WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw notFound('Vendor link');
      const after = await this.db.one(tx, 'UPDATE planting_year_vendors SET active = false, updated_at = now() WHERE id = $1 RETURNING *', [id]);
      await this.audit.record({ actorId: user.id, action: 'planting_year_vendor.unlink', entityType: 'planting_year_vendor', entityId: id, projectId: before.project_id, before, after }, tx);
      return after;
    });
  }
}
