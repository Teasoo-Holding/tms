import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/auth.decorators';
import { Db, isUniqueViolation } from '../database/db.service';
import { CustomFieldError, CustomValue, validateCustomValues } from '../domain/custom-fields';
import {
  assemblePhysicalId,
  ComponentType,
  ComponentValues,
  IdScheme,
  normalizePhysicalId,
  physicalIdScopeKey,
  serialScopeKey,
  TreeIdError,
} from '../domain/tree-id';
import { OperationContext, OperationResult, Rejection } from './operation-result';

const COMPONENT_VALUE_KEYS = ['PROJECT_CODE', 'PLANTING_YEAR', 'VENDOR_CODE', 'SECTOR_CODE', 'SUB_SECTOR_CODE'] as const;

/** Why the visit was made: an ordinary visit, the first data collection on existing trees, at planting, or maintenance. */
export const VISIT_TYPES = ['VISIT', 'FIRST_INSTANCE', 'PLANTING', 'MAINTENANCE'] as const;
const visitType = z.enum(VISIT_TYPES).default('VISIT');

const customFields = z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length <= 20_000, 'Too much custom field data');

/** Height typed in, or measured on the photo against a reference stick (points kept for review). */
const height = {
  height_cm: z.number().positive().lt(20000).nullish(),
  height_method: z.enum(['MANUAL', 'PHOTO_REFERENCE']).nullish(),
  height_measurement: z
    .record(z.string(), z.unknown())
    .refine((v) => JSON.stringify(v).length <= 4000, 'Measurement details are too large')
    .nullish(),
};

export const CreateTreePayload = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  planting_year_id: z.string().uuid(),
  sector_id: z.string().uuid(),
  sub_sector_id: z.string().uuid(),
  species_id: z.string().uuid(),
  vendor_id: z.string().uuid().nullish(),
  id_scheme_id: z.string().uuid(),
  serial_input: z.string().max(32),
  /** Full ID as confirmed by the officer against the label. Optional for web entry. */
  physical_tree_id: z.string().max(200).optional(),
  /** Code values the device assembled the prefix from (its cache may predate a code change). */
  id_component_values: z.record(z.enum(COMPONENT_VALUE_KEYS), z.string().max(32).nullable()).optional(),
  replaces_tree_id: z.string().uuid().nullish(),
  /** Administrators may give a replanted tree an ID of their choosing instead of the format's. */
  custom_physical_id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9\-_/.]*$/, 'Use letters, digits, - _ / .').optional(),
  planted_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  notes: z.string().max(4000).nullish(),
  custom_fields: customFields.optional(),
  client_recorded_at: z.string().datetime({ offset: true }).optional(),
  initial_observation: z.object({
    id: z.string().uuid(),
    status_id: z.string().uuid(),
    observed_at: z.string().datetime({ offset: true }),
    remarks: z.string().max(4000).nullish(),
    custom_fields: customFields.optional(),
    visit_type: visitType,
    ...height,
  }),
});
export type CreateTree = z.infer<typeof CreateTreePayload>;

export const UpdateTreePayload = z.object({
  id: z.string().uuid(),
  base_revision: z.number().int().positive(),
  changes: z
    .object({
      species_id: z.string().uuid(),
      vendor_id: z.string().uuid().nullable(),
      planted_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      notes: z.string().max(4000).nullable(),
      /** Replaces the whole map of extra field values. */
      custom_fields: customFields,
    })
    .partial()
    .refine((c) => Object.keys(c).length > 0, 'No changes supplied'),
});
export type UpdateTree = z.infer<typeof UpdateTreePayload>;

export const ObservationPayload = z.object({
  id: z.string().uuid(),
  tree_id: z.string().uuid(),
  observed_status_id: z.string().uuid(),
  observed_at: z.string().datetime({ offset: true }),
  recorded_at: z.string().datetime({ offset: true }).optional(),
  remarks: z.string().max(4000).nullish(),
  amends_observation_id: z.string().uuid().nullish(),
  amendment_reason: z.string().max(1000).nullish(),
  custom_fields: customFields.optional(),
  visit_type: visitType,
  ...height,
});
export type Observation = z.infer<typeof ObservationPayload>;

// Tolerate modest device clock drift, but reject observations clearly in the future.
const MAX_CLOCK_SKEW_MS = 24 * 3600_000;

@Injectable()
export class TreesService {
  constructor(private readonly db: Db, private readonly access: AccessService, private readonly audit: AuditService) {}

  // ------------------------------------------------------------------ registration
  async createTree(tx: PoolClient, actor: AuthUser, p: CreateTree, ctx: OperationContext): Promise<OperationResult> {
    const existing = await this.db.one(tx, 'SELECT * FROM trees WHERE id = $1', [p.id]);
    if (existing) {
      // Idempotent create keyed by the device-generated UUID.
      if (existing.project_id === p.project_id && existing.created_by === actor.id) {
        return { status: 'ALREADY_PROCESSED', entity: existing };
      }
      throw new Rejection('ENTITY_ID_REUSED', 'This record ID is already used by a different tree.');
    }

    const project = await this.db.one(tx, 'SELECT * FROM projects WHERE id = $1', [p.project_id]);
    if (!project) throw new Rejection('PROJECT_NOT_FOUND', 'The project no longer exists.');
    if (project.status === 'ARCHIVED' || (actor.role !== 'ADMIN' && project.status !== 'ACTIVE')) {
      throw new Rejection('PROJECT_NOT_ACTIVE', `Project ${project.name} is ${project.status.toLowerCase()} and not accepting registrations.`);
    }
    const year = await this.db.one(tx, 'SELECT * FROM planting_years WHERE id = $1 AND project_id = $2', [p.planting_year_id, p.project_id]);
    if (!year) throw new Rejection('PLANTING_YEAR_INVALID', 'The planting year does not belong to this project.');
    if (!year.active && actor.role !== 'ADMIN') {
      throw new Rejection('PLANTING_YEAR_CLOSED', `Planting year ${year.year_label} is closed. Ask an administrator to back-enter this tree.`);
    }
    const area = await this.db.one(
      tx,
      `SELECT ss.*, s.short_code AS sector_code, s.active AS sector_active, s.planting_year_id AS sector_year_id
         FROM sub_sectors ss JOIN sectors s ON s.id = ss.sector_id
        WHERE ss.id = $1 AND ss.sector_id = $2 AND ss.project_id = $3`,
      [p.sub_sector_id, p.sector_id, p.project_id],
    );
    if (!area) throw new Rejection('AREA_INVALID', 'The sub-sector does not belong to the selected sector and project.');
    // Areas are surveyed per planting year; a tree belongs to an area of its own year.
    if (area.sector_year_id && area.sector_year_id !== p.planting_year_id) {
      throw new Rejection('AREA_OTHER_YEAR', `Sector ${area.sector_code} belongs to a different planting year's survey.`);
    }
    if (!area.active || !area.sector_active) throw new Rejection('AREA_INACTIVE', 'The selected area has been deactivated.');
    const grants = await this.access.grants(actor, tx);
    if (!this.access.canAccessArea(grants, p.project_id, p.sector_id, p.sub_sector_id)) {
      throw new Rejection('AREA_NOT_ASSIGNED', 'You are not assigned to this area.');
    }

    const species = await this.db.one(tx, 'SELECT active FROM tree_species WHERE id = $1', [p.species_id]);
    if (!species?.active) throw new Rejection('SPECIES_INVALID', 'The species is unknown or deactivated.');
    const status = await this.db.one(tx, 'SELECT * FROM tree_statuses WHERE id = $1', [p.initial_observation.status_id]);
    if (!status?.active) throw new Rejection('STATUS_INVALID', 'The status is unknown or deactivated.');
    this.assertNotFuture(p.initial_observation.observed_at);

    const schemeRow = await this.db.one(tx, 'SELECT * FROM tree_id_schemes WHERE id = $1 AND project_id = $2', [p.id_scheme_id, p.project_id]);
    if (!schemeRow) throw new Rejection('SCHEME_INVALID', 'The ID format does not belong to this project.');
    const scheme = toScheme(schemeRow);

    let vendor: any = null;
    if (p.vendor_id) {
      vendor = await this.db.one(tx, 'SELECT * FROM vendors WHERE id = $1', [p.vendor_id]);
      if (!vendor?.active) throw new Rejection('VENDOR_INVALID', 'The vendor is unknown or deactivated.');
    }
    const vendorNeeded =
      scheme.components.some((c) => c.type === 'VENDOR_CODE' && c.required) || scheme.serialUniquenessScope.includes('VENDOR');
    if (vendorNeeded && !vendor) throw new Rejection('VENDOR_REQUIRED', 'This ID format requires a vendor.');

    // Current codes from the server; the device's values (from its cache) take precedence
    // because they are what was printed on the label and confirmed by the officer.
    const currentValues: Record<string, string | null> = {
      PROJECT_CODE: project.short_code,
      PLANTING_YEAR: year.year_label,
      VENDOR_CODE: vendor?.short_code ?? null,
      SECTOR_CODE: area.sector_code,
      SUB_SECTOR_CODE: area.short_code,
    };
    const values: ComponentValues = { ...currentValues, ...(p.id_component_values ?? {}) };
    let assembled;
    const custom = p.custom_physical_id;
    if (custom) {
      if (actor.role !== 'ADMIN') throw new Rejection('CUSTOM_ID_NOT_ALLOWED', 'Only an administrator can set a tree ID by hand.');
      if (!p.replaces_tree_id) throw new Rejection('CUSTOM_ID_NOT_ALLOWED', 'A hand-set tree ID is only for replanted (replacement) trees.');
      const normalized = normalizePhysicalId(custom);
      assembled = { prefix: '', serial: normalized, physicalId: custom, normalized };
    } else {
      try {
        assembled = assemblePhysicalId(scheme, values, p.serial_input);
      } catch (e) {
        if (e instanceof TreeIdError) throw new Rejection(e.code, idErrorMessage(e.code));
        throw e;
      }
    }
    if (p.physical_tree_id && normalizePhysicalId(p.physical_tree_id) !== assembled.normalized) {
      throw new Rejection('ID_MISMATCH', `The confirmed ID ${p.physical_tree_id} does not match the assembled ID ${assembled.physicalId}.`);
    }
    const entityIds: Record<string, string | null> = {
      PROJECT_CODE: project.id,
      PLANTING_YEAR: year.id,
      VENDOR_CODE: vendor?.id ?? null,
      SECTOR_CODE: p.sector_id,
      SUB_SECTOR_CODE: p.sub_sector_id,
    };
    const snapshot = custom ? {
      scheme_version: schemeRow.version,
      separator: '',
      serial_width: assembled.serial.length,
      custom: true,
      components: [{ type: 'CUSTOM', value: assembled.physicalId, entity_id: null, matches_current_code: true }],
    } : {
      scheme_version: schemeRow.version,
      separator: scheme.separator,
      serial_width: scheme.serialWidth,
      components: scheme.components.map((c) => {
        if (c.type === 'SERIAL') return { type: c.type, value: assembled.serial, entity_id: null, matches_current_code: true };
        if (c.type === 'TEXT') return { type: c.type, value: c.value?.toUpperCase() ?? null, entity_id: null, matches_current_code: true };
        const v = (values[c.type as keyof ComponentValues] ?? null)?.toUpperCase() ?? null;
        return { type: c.type, value: v, entity_id: entityIds[c.type], matches_current_code: v === (currentValues[c.type] ?? null) };
      }),
    };
    // Hand-set IDs live outside the format's serial numbering; the full ID is still unique.
    const serialKey = custom
      ? `CUSTOM|PROJECT=${project.id}`
      : serialScopeKey(scheme.serialUniquenessScope, {
          project: project.id,
          plantingYear: year.id,
          vendor: vendor?.id ?? null,
          sector: p.sector_id,
          subSector: p.sub_sector_id,
        });
    if (!custom) await this.assertSerialAllocated(tx, actor, serialKey, assembled.serial);

    if (p.replaces_tree_id) await this.assertReplaceable(tx, p.replaces_tree_id, p.project_id);
    const treeFields = await this.customValues(tx, p.project_id, 'TREE', p.custom_fields);

    const insertValues = [
      p.id, assembled.physicalId, assembled.normalized, physicalIdScopeKey(project.physical_id_uniqueness, project.id),
      assembled.serial, serialKey, schemeRow.id, schemeRow.version, JSON.stringify(snapshot), p.project_id, p.planting_year_id,
      p.sector_id, p.sub_sector_id, p.species_id, p.vendor_id ?? null, p.replaces_tree_id ?? null, p.planted_on ?? null,
      p.notes ?? null, actor.id, ctx.deviceId, p.client_recorded_at ?? null, JSON.stringify(treeFields),
    ];
    const insertSql = (state: string) => `
      INSERT INTO trees (id, physical_tree_id, physical_tree_id_normalized, physical_id_scope_key, serial_number, serial_scope_key,
        id_scheme_id, id_scheme_version, id_components_snapshot, project_id, planting_year_id, sector_id, sub_sector_id, species_id,
        vendor_id, replaces_tree_id, planted_on, notes, created_by, device_id, client_recorded_at, custom_fields, record_state)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'${state}') RETURNING *`;

    let tree: any;
    let conflict: { type: string; existingId: string | null; message: string } | null = null;
    await tx.query('SAVEPOINT tree_insert');
    try {
      tree = await this.db.one(tx, insertSql('ACTIVE'), insertValues);
      await tx.query('RELEASE SAVEPOINT tree_insert');
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      await tx.query('ROLLBACK TO SAVEPOINT tree_insert');
      conflict = await this.describeCollision(tx, e.constraint, insertValues);
      // Preserve the incoming record (and later its media) for administrator review; never overwrite.
      tree = await this.db.one(tx, insertSql('CONFLICT'), insertValues);
    }

    await this.insertObservation(tx, actor, ctx, {
      id: p.initial_observation.id,
      tree_id: tree.id,
      observed_status_id: p.initial_observation.status_id,
      observed_at: p.initial_observation.observed_at,
      recorded_at: p.client_recorded_at,
      remarks: p.initial_observation.remarks,
      custom_fields: p.initial_observation.custom_fields,
      visit_type: p.initial_observation.visit_type,
      height_cm: p.initial_observation.height_cm,
      height_method: p.initial_observation.height_method,
      height_measurement: p.initial_observation.height_measurement,
    }, true);
    tree = await this.recomputeStatus(tx, tree.id);
    // Every record is attributable to the account that entered it (and the device it came from).
    await this.audit.record(
      {
        actorId: actor.id, action: 'tree.create', entityType: 'tree', entityId: tree.id, projectId: tree.project_id,
        after: { physical_tree_id: tree.physical_tree_id, record_state: tree.record_state, custom_fields: tree.custom_fields },
        metadata: { device_id: ctx.deviceId, operation_id: ctx.operationId },
      },
      tx,
    );

    if (p.replaces_tree_id && !conflict) {
      await this.audit.record(
        { actorId: actor.id, action: 'tree.replacement', entityType: 'tree', entityId: tree.id, projectId: tree.project_id, metadata: { replaces_tree_id: p.replaces_tree_id } },
        tx,
      );
    }
    if (conflict) {
      const record = await this.db.one(
        tx,
        `INSERT INTO conflict_records (conflict_type, project_id, entity_type, entity_id, existing_entity_id, operation_id, device_id, submitted_by, details)
         VALUES ($1, $2, 'tree', $3, $4, $5, $6, $7, $8) RETURNING id`,
        [conflict.type, tree.project_id, tree.id, conflict.existingId, ctx.operationId, ctx.deviceId, actor.id, JSON.stringify({ physical_tree_id: tree.physical_tree_id, serial_number: tree.serial_number })],
      );
      await this.audit.record(
        { actorId: actor.id, action: 'conflict.create', entityType: 'conflict', entityId: record!.id, projectId: tree.project_id, metadata: { type: conflict.type, tree_id: tree.id } },
        tx,
      );
      return { status: 'CONFLICT', code: conflict.type, message: conflict.message, entity: tree, conflict_id: record!.id, existing_entity_id: conflict.existingId ?? undefined };
    }
    return { status: 'ACCEPTED', entity: tree };
  }

  private async describeCollision(tx: PoolClient, constraint: string, v: unknown[]) {
    if (constraint === 'trees_single_replacement') {
      const other = await this.db.one(tx, `SELECT id, physical_tree_id FROM trees WHERE replaces_tree_id = $1 AND record_state = 'ACTIVE'`, [v[15]]);
      return {
        type: 'DUPLICATE_REPLACEMENT',
        existingId: other?.id ?? null,
        message: `The original tree has already been replaced by ${other?.physical_tree_id}. This submission is kept for review.`,
      };
    }
    if (constraint === 'trees_serial_unique') {
      const other = await this.db.one(tx, `SELECT id, physical_tree_id FROM trees WHERE serial_scope_key = $1 AND serial_number = $2 AND record_state = 'ACTIVE'`, [v[5], v[4]]);
      return {
        type: 'DUPLICATE_SERIAL',
        existingId: other?.id ?? null,
        message: `Serial ${v[4]} is already used by ${other?.physical_tree_id}. This submission is kept for review.`,
      };
    }
    const other = await this.db.one(
      tx,
      `SELECT id FROM trees WHERE physical_id_scope_key = $1 AND physical_tree_id_normalized = $2 AND record_state = 'ACTIVE'`,
      [v[3], v[2]],
    );
    return {
      type: 'DUPLICATE_PHYSICAL_ID',
      existingId: other?.id ?? null,
      message: `Tree ID ${v[1]} is already registered. This submission is kept for review by an administrator.`,
    };
  }

  private async assertSerialAllocated(tx: PoolClient, actor: AuthUser, scopeKey: string, serial: string) {
    const { rows } = await tx.query('SELECT user_id, range_start, range_end FROM serial_allocations WHERE active AND scope_key = $1', [scopeKey]);
    if (rows.length === 0) return; // no pre-allocation policy for this scope
    const n = Number(serial);
    const ok = rows.some((r) => n >= r.range_start && n <= r.range_end && (r.user_id === null || r.user_id === actor.id || actor.role === 'ADMIN'));
    if (!ok) throw new Rejection('SERIAL_NOT_ALLOCATED', `Serial ${serial} is outside the ranges allocated to you for this scope.`);
  }

  private async assertReplaceable(tx: PoolClient, originalId: string, projectId: string) {
    const original = await this.db.one(
      tx,
      `SELECT t.project_id, t.record_state, s.allows_replacement, s.name AS status_name
         FROM trees t LEFT JOIN tree_statuses s ON s.id = t.current_status_id WHERE t.id = $1`,
      [originalId],
    );
    if (!original) throw new Rejection('ORIGINAL_NOT_FOUND', 'The tree being replaced was not found.');
    if (original.project_id !== projectId) throw new Rejection('ORIGINAL_OTHER_PROJECT', 'A replacement must be in the same project as the original.');
    if (original.record_state !== 'ACTIVE') throw new Rejection('ORIGINAL_NOT_ACTIVE', 'The original tree is not an active registry record.');
    if (!original.allows_replacement) {
      throw new Rejection('ORIGINAL_NOT_REPLACEABLE', `A tree with status "${original.status_name ?? 'unknown'}" cannot be replaced. Record it as dead or missing first.`);
    }
  }

  // ------------------------------------------------------------------ metadata edits
  async updateTree(tx: PoolClient, actor: AuthUser, p: UpdateTree, ctx: OperationContext): Promise<OperationResult> {
    const tree = await this.db.one(tx, 'SELECT * FROM trees WHERE id = $1 FOR UPDATE', [p.id]);
    if (!tree) throw new Rejection('TREE_NOT_FOUND', 'The tree was not found on the server.');
    const grants = await this.access.grants(actor, tx);
    if (!this.access.canAccessArea(grants, tree.project_id, tree.sector_id, tree.sub_sector_id)) {
      throw new Rejection('AREA_NOT_ASSIGNED', 'You are not assigned to this tree’s area.');
    }
    if (p.changes.species_id) {
      const species = await this.db.one(tx, 'SELECT active FROM tree_species WHERE id = $1', [p.changes.species_id]);
      if (!species?.active) throw new Rejection('SPECIES_INVALID', 'The species is unknown or deactivated.');
    }
    if (p.changes.vendor_id !== undefined) {
      const snapshot = tree.id_components_snapshot;
      if (snapshot.components.some((c: any) => c.type === 'VENDOR_CODE')) {
        throw new Rejection('VENDOR_IN_ID', 'The vendor is part of this tree’s ID. Use an ID correction instead.');
      }
      if (p.changes.vendor_id) {
        const vendor = await this.db.one(tx, 'SELECT active FROM vendors WHERE id = $1', [p.changes.vendor_id]);
        if (!vendor?.active) throw new Rejection('VENDOR_INVALID', 'The vendor is unknown or deactivated.');
      }
    }
    if (p.changes.custom_fields !== undefined) {
      p.changes.custom_fields = await this.customValues(tx, tree.project_id, 'TREE', p.changes.custom_fields);
    }
    if (tree.revision !== p.base_revision) {
      // Concurrent edit: never last-write-wins. Keep the incoming change for review.
      const record = await this.db.one(
        tx,
        `INSERT INTO conflict_records (conflict_type, project_id, entity_type, entity_id, existing_entity_id, operation_id, device_id, submitted_by, details)
         VALUES ('REVISION_MISMATCH', $1, 'tree', $2, $2, $3, $4, $5, $6) RETURNING id`,
        [tree.project_id, tree.id, ctx.operationId, ctx.deviceId, actor.id, JSON.stringify({ base_revision: p.base_revision, server_revision: tree.revision, changes: p.changes })],
      );
      return {
        status: 'CONFLICT',
        code: 'REVISION_MISMATCH',
        message: 'This tree was changed by someone else since you edited it. Your edit is kept for administrator review.',
        entity: tree,
        conflict_id: record!.id,
      };
    }
    const after = await this.applyChanges(tx, actor, tree, p.changes);
    return { status: 'ACCEPTED', entity: after };
  }

  async applyChanges(tx: PoolClient, actor: AuthUser, tree: any, changes: UpdateTree['changes']) {
    const n = { ...tree, ...changes };
    const after = await this.db.one(
      tx,
      `UPDATE trees SET species_id = $2, vendor_id = $3, planted_on = $4, notes = $5, custom_fields = $7, revision = revision + 1,
              updated_at = now(), updated_by = $6 WHERE id = $1 RETURNING *`,
      [tree.id, n.species_id, n.vendor_id, n.planted_on, n.notes, actor.id, JSON.stringify(n.custom_fields ?? {})],
    );
    await this.audit.record({ actorId: actor.id, action: 'tree.update', entityType: 'tree', entityId: tree.id, projectId: tree.project_id, before: tree, after }, tx);
    return after;
  }

  // ------------------------------------------------------------------ observations
  async addObservation(tx: PoolClient, actor: AuthUser, p: Observation, ctx: OperationContext): Promise<OperationResult> {
    const existing = await this.db.one(tx, 'SELECT * FROM tree_observations WHERE id = $1', [p.id]);
    if (existing) {
      if (existing.tree_id === p.tree_id) return { status: 'ALREADY_PROCESSED', entity: existing };
      throw new Rejection('ENTITY_ID_REUSED', 'This observation ID is already used for a different tree.');
    }
    const tree = await this.db.one(tx, 'SELECT * FROM trees WHERE id = $1 FOR UPDATE', [p.tree_id]);
    if (!tree) throw new Rejection('TREE_NOT_FOUND', 'The tree was not found on the server. Sync the tree registration first.');
    const grants = await this.access.grants(actor, tx);
    if (!this.access.canAccessArea(grants, tree.project_id, tree.sector_id, tree.sub_sector_id)) {
      throw new Rejection('AREA_NOT_ASSIGNED', 'You are not assigned to this tree’s area.');
    }
    const status = await this.db.one(tx, 'SELECT active FROM tree_statuses WHERE id = $1', [p.observed_status_id]);
    if (!status?.active) throw new Rejection('STATUS_INVALID', 'The status is unknown or deactivated.');
    this.assertNotFuture(p.observed_at);

    if (p.amends_observation_id) {
      const target = await this.db.one(tx, 'SELECT * FROM tree_observations WHERE id = $1', [p.amends_observation_id]);
      if (!target || target.tree_id !== p.tree_id) throw new Rejection('AMENDMENT_TARGET_INVALID', 'The observation being corrected belongs to another tree.');
      if (actor.role !== 'ADMIN' && target.recorded_by !== actor.id) {
        throw new Rejection('AMENDMENT_NOT_ALLOWED', 'Only the original recorder or an administrator can correct an observation.');
      }
      if (!p.amendment_reason?.trim()) throw new Rejection('AMENDMENT_REASON_REQUIRED', 'Give a reason for the correction.');
    }

    const obs = await this.insertObservation(tx, actor, ctx, p, false);
    await this.audit.record(
      {
        actorId: actor.id, action: 'observation.create', entityType: 'observation', entityId: obs.id, projectId: tree.project_id,
        after: { tree_id: tree.id, physical_tree_id: tree.physical_tree_id, observed_status_id: obs.observed_status_id, observed_at: obs.observed_at, height_cm: obs.height_cm },
        metadata: { device_id: ctx.deviceId, operation_id: ctx.operationId },
      },
      tx,
    );
    if (p.amends_observation_id) {
      await this.audit.record(
        { actorId: actor.id, action: 'observation.amend', entityType: 'observation', entityId: obs.id, projectId: tree.project_id, metadata: { amends: p.amends_observation_id, reason: p.amendment_reason } },
        tx,
      );
    }
    await this.recomputeStatus(tx, tree.id);
    return { status: 'ACCEPTED', entity: obs };
  }

  private async insertObservation(tx: PoolClient, actor: AuthUser, ctx: OperationContext, p: Observation, initial: boolean) {
    const tree = await this.db.one(tx, 'SELECT project_id FROM trees WHERE id = $1', [p.tree_id]);
    const fields = await this.customValues(tx, tree!.project_id, 'OBSERVATION', p.custom_fields);
    const heightCm = p.height_cm == null ? null : Math.round(p.height_cm * 10) / 10;
    return (await this.db.one(
      tx,
      `INSERT INTO tree_observations (id, tree_id, observed_status_id, observed_at, recorded_at, recorded_by, device_id, remarks,
                                      is_initial, is_amendment, amends_observation_id, amendment_reason, custom_fields,
                                      height_cm, height_method, height_measurement, visit_type)
       VALUES ($1, $2, $3, $4, COALESCE($5, now()), $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
      [
        p.id, p.tree_id, p.observed_status_id, p.observed_at, p.recorded_at ?? null, actor.id, ctx.deviceId, p.remarks ?? null,
        initial, !!p.amends_observation_id, p.amends_observation_id ?? null, p.amendment_reason ?? null, JSON.stringify(fields),
        heightCm, heightCm == null ? null : (p.height_method ?? 'MANUAL'),
        heightCm == null || !p.height_measurement ? null : JSON.stringify(p.height_measurement),
        p.visit_type ?? 'VISIT',
      ],
    ))!;
  }

  /** Validates extra field values against the project's definitions (including deactivated ones). */
  private async customValues(tx: PoolClient, projectId: string, appliesTo: 'TREE' | 'OBSERVATION', values: Record<string, unknown> | undefined) {
    if (!values || Object.keys(values).length === 0) return {} as Record<string, CustomValue>;
    const { rows } = await tx.query(
      'SELECT key, label, field_type, options, required, active FROM custom_field_definitions WHERE project_id = $1 AND applies_to = $2',
      [projectId, appliesTo],
    );
    try {
      return validateCustomValues(rows, values);
    } catch (e) {
      if (e instanceof CustomFieldError) throw new Rejection(e.code, e.message);
      throw e;
    }
  }

  /** current_status_id is a cache; the effective observation history is authoritative. */
  async recomputeStatus(tx: PoolClient, treeId: string) {
    return this.db.one(
      tx,
      `UPDATE trees t SET current_status_id = s.observed_status_id, last_observed_at = s.observed_at
         FROM (SELECT o.observed_status_id, o.observed_at FROM tree_observations o
                WHERE o.tree_id = $1
                  AND NOT EXISTS (SELECT 1 FROM tree_observations a WHERE a.amends_observation_id = o.id)
                ORDER BY o.observed_at DESC, o.recorded_at DESC LIMIT 1) s
        WHERE t.id = $1 RETURNING t.*`,
      [treeId],
    );
  }

  // ------------------------------------------------------------------ ID corrections
  /** Authorised, audited correction of a tree's serial. The prior value is preserved in history. */
  async correctSerial(tx: PoolClient, actor: AuthUser, treeId: string, serialInput: string, reason: string, activate = false) {
    const tree = await this.db.one(tx, 'SELECT * FROM trees WHERE id = $1 FOR UPDATE', [treeId]);
    if (!tree) throw new Rejection('TREE_NOT_FOUND', 'The tree was not found.');
    const snapshot = tree.id_components_snapshot;
    const scheme: IdScheme = {
      separator: snapshot.separator,
      serialWidth: snapshot.serial_width,
      components: snapshot.components.map((c: any) => ({ type: c.type, required: c.value != null, value: c.type === 'TEXT' ? c.value : undefined })),
      serialUniquenessScope: [],
    };
    const values: ComponentValues = Object.fromEntries(snapshot.components.filter((c: any) => c.type !== 'SERIAL').map((c: any) => [c.type, c.value]));
    let assembled;
    if (snapshot.custom) {
      // A hand-set ID is corrected by entering the whole new ID.
      const id = serialInput.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9\-_/.]{0,63}$/.test(id)) throw new Rejection('CUSTOM_ID_INVALID', 'Enter the full tree ID (letters, digits, - _ / .).');
      const normalized = normalizePhysicalId(id);
      assembled = { physicalId: id, normalized, serial: normalized };
    } else {
      try {
        assembled = assemblePhysicalId(scheme, values, serialInput);
      } catch (e) {
        if (e instanceof TreeIdError) throw new Rejection(e.code, idErrorMessage(e.code));
        throw e;
      }
    }
    const newSnapshot = {
      ...snapshot,
      components: snapshot.components.map((c: any) => (c.type === 'SERIAL' || c.type === 'CUSTOM' ? { ...c, value: c.type === 'CUSTOM' ? assembled.physicalId : assembled.serial } : c)),
    };
    const state = activate ? 'ACTIVE' : tree.record_state;
    await tx.query('SAVEPOINT correct_serial');
    let after;
    try {
      after = await this.db.one(
        tx,
        `UPDATE trees SET physical_tree_id = $2, physical_tree_id_normalized = $3, serial_number = $4, id_components_snapshot = $5,
                record_state = $6, revision = revision + 1, updated_at = now(), updated_by = $7 WHERE id = $1 RETURNING *`,
        [treeId, assembled.physicalId, assembled.normalized, assembled.serial, JSON.stringify(newSnapshot), state, actor.id],
      );
      await tx.query('RELEASE SAVEPOINT correct_serial');
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      await tx.query('ROLLBACK TO SAVEPOINT correct_serial');
      throw new Rejection('DUPLICATE_PHYSICAL_ID', `${assembled.physicalId} is already registered. Choose a different serial.`);
    }
    await tx.query(
      `INSERT INTO tree_physical_id_history (tree_id, previous_physical_id, previous_serial, new_physical_id, new_serial, reason, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [treeId, tree.physical_tree_id, tree.serial_number, assembled.physicalId, assembled.serial, reason, actor.id],
    );
    await this.audit.record({ actorId: actor.id, action: 'tree.id_correction', entityType: 'tree', entityId: treeId, projectId: tree.project_id, before: tree, after, metadata: { reason } }, tx);
    return after;
  }

  private assertNotFuture(iso: string) {
    if (new Date(iso).getTime() > Date.now() + MAX_CLOCK_SKEW_MS) {
      throw new Rejection('OBSERVED_AT_IN_FUTURE', 'The observation date is in the future. Check the device date and time.');
    }
  }
}

export function toScheme(row: any): IdScheme {
  return {
    separator: row.separator,
    serialWidth: row.serial_width,
    components: row.component_definition,
    serialUniquenessScope: row.serial_uniqueness_scope,
  };
}

function idErrorMessage(code: string): string {
  switch (code) {
    case 'SERIAL_REQUIRED':
      return 'Enter the serial number from the label.';
    case 'SERIAL_NOT_NUMERIC':
      return 'The serial number may contain digits only.';
    case 'SERIAL_TOO_LONG':
      return 'The serial number has more digits than the ID format allows.';
    case 'SERIAL_ZERO':
      return 'The serial number cannot be zero.';
    default:
      if (code.startsWith('COMPONENT_MISSING:')) return `The ID format needs a value for ${code.split(':')[1]}.`;
      return 'The tree ID could not be assembled.';
  }
}
