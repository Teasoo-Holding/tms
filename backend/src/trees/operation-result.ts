export type ResultStatus = 'ACCEPTED' | 'ALREADY_PROCESSED' | 'CONFLICT' | 'REJECTED';

export interface OperationResult {
  status: ResultStatus;
  code?: string;
  message?: string;
  entity?: any;
  conflict_id?: string;
  existing_entity_id?: string;
}

/** Thrown inside an operation to reject it with a code the device can show and act on. */
export class Rejection extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export interface OperationContext {
  deviceId: string | null;
  operationId: string | null;
}
