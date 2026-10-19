import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { z, ZodObject, ZodRawShape } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { AuditService } from '../common/audit.service';
import { badRequest, notFound } from '../common/errors';
import { parse, shortCode } from '../common/validation';
import { Db, isUniqueViolation } from '../database/db.service';

const SpeciesBody = z.object({
  scientific_name: z.string().trim().min(1).max(200),
  common_name: z.string().trim().max(200).nullish(),
  code: z.string().trim().max(32).nullish(),
  active: z.boolean().default(true),
});
const StatusBody = z.object({
  code: z.string().trim().regex(/^[A-Z_]{1,32}$/, 'Use upper-case letters and underscores'),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).nullish(),
  is_terminal: z.boolean().default(false),
  allows_replacement: z.boolean().default(false),
  requires_photo: z.boolean().default(false),
  sort_order: z.number().int().default(0),
  active: z.boolean().default(true),
});
const VendorBody = z.object({
  name: z.string().trim().min(1).max(200),
  short_code: shortCode.nullish(),
  contact_name: z.string().max(200).nullish(),
  contact_phone: z.string().max(50).nullish(),
  contact_email: z.string().email().nullish(),
  location: z.string().max(500).nullish(),
  active: z.boolean().default(true),
});

/**
 * Species, statuses and vendors share the same lifecycle: create, edit, deactivate.
 * Rows are never deleted so historic trees keep valid references.
 */
interface Resource {
  table: string;
  entity: string;
  schema: ZodObject<ZodRawShape>;
  order: string;
  /** Fields that must not change once set, because they are part of registered identities. */
  immutable?: string[];
}

const RESOURCES: Record<string, Resource> = {
  'tree-species': { table: 'tree_species', entity: 'species', schema: SpeciesBody, order: 'scientific_name' },
  'tree-statuses': { table: 'tree_statuses', entity: 'status', schema: StatusBody, order: 'sort_order, name', immutable: ['code'] },
  vendors: { table: 'vendors', entity: 'vendor', schema: VendorBody, order: 'name' },
};

const PATHS = Object.keys(RESOURCES);

@Controller()
export class ReferenceController {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  /** Express 5 routes have no regex params, so the resource is read from the matched path. */
  private resource(req: Request): Resource {
    const name = req.path.split('/').find((segment) => segment in RESOURCES);
    if (!name) throw notFound('Resource');
    return RESOURCES[name];
  }

  @Get(PATHS)
  async list(@Req() req: Request) {
    const r = this.resource(req);
    return (await this.db.query(`SELECT * FROM ${r.table} ORDER BY ${r.order}`)).rows;
  }

  @Roles('ADMIN')
  @Post(PATHS)
  async create(@CurrentUser() user: AuthUser, @Req() req: Request, @Body() body: unknown) {
    const r = this.resource(req);
    const b = parse(r.schema, body) as Record<string, unknown>;
    const cols = Object.keys(b);
    return this.db.tx(async (tx) => {
      const row = await this.db
        .one(tx, `INSERT INTO ${r.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, cols.map((c) => b[c] ?? null))
        .catch(duplicate);
      await this.audit.record({ actorId: user.id, action: `${r.entity}.create`, entityType: r.entity, entityId: row!.id, after: row }, tx);
      return row;
    });
  }

  @Roles('ADMIN')
  @Patch(PATHS.map((p) => `${p}/:id`))
  async update(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const r = this.resource(req);
    const b = parse(r.schema.partial(), body) as Record<string, unknown>;
    for (const field of r.immutable ?? []) {
      if (field in b) throw badRequest('FIELD_IMMUTABLE', `${field} cannot be changed after creation.`);
    }
    const cols = Object.keys(b);
    if (cols.length === 0) throw badRequest('NOTHING_TO_UPDATE', 'Provide at least one field to update.');
    return this.db.tx(async (tx) => {
      const before = await this.db.one(tx, `SELECT * FROM ${r.table} WHERE id = $1 FOR UPDATE`, [id]);
      if (!before) throw notFound(r.entity);
      const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
      const after = await this.db
        .one(tx, `UPDATE ${r.table} SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`, [id, ...cols.map((c) => b[c] ?? null)])
        .catch(duplicate);
      // Vendor short-code changes do not rewrite registered tree IDs; their snapshots keep the old code.
      await this.audit.record({ actorId: user.id, action: `${r.entity}.update`, entityType: r.entity, entityId: id, before, after }, tx);
      return after;
    });
  }
}

function duplicate(e: any): never {
  if (isUniqueViolation(e)) throw badRequest('DUPLICATE', 'An entry with the same name or code already exists.');
  throw e;
}
