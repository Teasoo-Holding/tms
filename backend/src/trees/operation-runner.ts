import { PoolClient } from 'pg';
import { OperationResult, Rejection } from './operation-result';

/**
 * Runs a domain operation inside a savepoint. A Rejection undoes the operation's partial writes
 * but leaves the surrounding transaction usable (so the sync ledger can still record the outcome).
 */
export async function runOperation(tx: PoolClient, fn: () => Promise<OperationResult>): Promise<OperationResult> {
  await tx.query('SAVEPOINT operation');
  try {
    const result = await fn();
    await tx.query('RELEASE SAVEPOINT operation');
    return result;
  } catch (e) {
    await tx.query('ROLLBACK TO SAVEPOINT operation');
    if (e instanceof Rejection) return { status: 'REJECTED', code: e.code, message: e.message };
    throw e;
  }
}
