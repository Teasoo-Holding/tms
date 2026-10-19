import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser } from '../common/auth.decorators';
import { AppError, badRequest } from '../common/errors';
import { config } from '../config';
import { Db } from '../database/db.service';
import { OperationResult, Rejection } from '../trees/operation-result';
import { runOperation } from '../trees/operation-runner';
import { CreateTreePayload, ObservationPayload, TreesService, UpdateTreePayload } from '../trees/trees.service';

export const Operation = z.object({
  operation_id: z.string().uuid(),
  entity_type: z.enum(['tree', 'observation']),
  entity_id: z.string().uuid(),
  operation_type: z.enum(['create', 'update', 'observation', 'amendment']),
  base_revision: z.number().int().nullish(),
  client_recorded_at: z.string().datetime({ offset: true }),
  payload: z.record(z.unknown()),
});
export const BatchBody = z.object({
  device_id: z.string().uuid(),
  operations: z.array(Operation).min(1),
});
type Op = z.infer<typeof Operation>;

@Injectable()
export class SyncService {
  constructor(private readonly db: Db, private readonly trees: TreesService) {}

  async submitBatch(user: AuthUser, body: z.infer<typeof BatchBody>) {
    if (body.operations.length > config.syncBatchMaxOperations) {
      throw badRequest('BATCH_TOO_LARGE', `Send at most ${config.syncBatchMaxOperations} operations per batch.`);
    }
    if (user.deviceId && user.deviceId !== body.device_id) throw badRequest('DEVICE_MISMATCH', 'The device ID does not match this session.');
    const device = await this.db.one(this.db, 'SELECT user_id, revoked_at FROM devices WHERE id = $1', [body.device_id]);
    if (!device || device.user_id !== user.id) throw new AppError(403, 'DEVICE_NOT_REGISTERED', 'Sign in on this device before syncing.');
    if (device.revoked_at) throw new AppError(401, 'DEVICE_REVOKED', 'This device has been revoked. Contact an administrator.');

    const batch = await this.db.one(
      this.db,
      'INSERT INTO sync_batches (device_id, user_id, operation_count) VALUES ($1, $2, $3) RETURNING id',
      [body.device_id, user.id, body.operations.length],
    );
    // Operations are applied in the device's order, each in its own transaction, so one failure
    // never blocks unrelated records and every outcome is reported per item.
    const results: any[] = [];
    for (const op of body.operations) results.push(await this.processOperation(user, body.device_id, batch!.id, op));

    const count = (s: string) => results.filter((r) => r.status === s).length;
    await this.db.query(
      'UPDATE sync_batches SET accepted = $2, already_processed = $3, conflicts = $4, rejected = $5 WHERE id = $1',
      [batch!.id, count('ACCEPTED'), count('ALREADY_PROCESSED'), count('CONFLICT'), count('REJECTED')],
    );
    await this.db.query('UPDATE devices SET last_sync_at = now(), last_seen_at = now() WHERE id = $1', [body.device_id]);
    return { batch_id: batch!.id, server_time: new Date().toISOString(), results };
  }

  private async processOperation(user: AuthUser, deviceId: string, batchId: string, op: Op) {
    return this.db.tx(async (tx) => {
      // Serialise concurrent retries of the same operation.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [op.operation_id]);
      const previous = await this.db.one(tx, 'SELECT * FROM sync_operations WHERE operation_id = $1', [op.operation_id]);
      if (previous) {
        return { operation_id: op.operation_id, ...previous.result, status: 'ALREADY_PROCESSED', original_status: previous.result_status };
      }
      const ctx = { deviceId, operationId: op.operation_id };
      const result: OperationResult = await runOperation(tx, async () => {
        if (op.entity_id !== (op.payload as any).id) throw new Rejection('ENTITY_ID_MISMATCH', 'entity_id must match payload.id.');
        switch (`${op.entity_type}:${op.operation_type}`) {
          case 'tree:create':
            return this.trees.createTree(tx, user, this.payload(CreateTreePayload, { client_recorded_at: op.client_recorded_at, ...op.payload }), ctx);
          case 'tree:update':
            return this.trees.updateTree(tx, user, this.payload(UpdateTreePayload, { base_revision: op.base_revision, ...op.payload }), ctx);
          case 'observation:observation':
          case 'observation:amendment': {
            const p = this.payload(ObservationPayload, { recorded_at: op.client_recorded_at, ...op.payload });
            if ((op.operation_type === 'amendment') !== !!p.amends_observation_id) {
              throw new Rejection('OPERATION_TYPE_MISMATCH', 'Amendments must reference the observation they correct.');
            }
            return this.trees.addObservation(tx, user, p, ctx);
          }
          default:
            throw new Rejection('OPERATION_UNSUPPORTED', `Unsupported operation ${op.entity_type}:${op.operation_type}.`);
        }
      });
      const stored = {
        status: result.status,
        code: result.code,
        message: result.message,
        entity_id: op.entity_id,
        entity: result.entity,
        conflict_id: result.conflict_id,
        existing_entity_id: result.existing_entity_id,
      };
      await tx.query(
        `INSERT INTO sync_operations (operation_id, batch_id, device_id, user_id, entity_type, entity_id, operation_type, base_revision,
                                      client_recorded_at, payload, result_status, result)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [op.operation_id, batchId, deviceId, user.id, op.entity_type, op.entity_id, op.operation_type, op.base_revision ?? null,
          op.client_recorded_at, JSON.stringify(op.payload), result.status, JSON.stringify(stored)],
      );
      return { operation_id: op.operation_id, ...stored };
    });
  }

  private payload<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
    const r = schema.safeParse(input);
    if (!r.success) {
      throw new Rejection('VALIDATION_FAILED', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    return r.data;
  }
}
