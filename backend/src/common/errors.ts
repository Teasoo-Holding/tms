import { HttpException, HttpStatus } from '@nestjs/common';

/** Error with a stable machine-readable code and a message that tells the user what to do next. */
export class AppError extends HttpException {
  constructor(status: HttpStatus, public readonly code: string, message: string, details?: unknown) {
    super({ code, message, details }, status);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(HttpStatus.BAD_REQUEST, code, message, details);
export const notFound = (what: string) => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} was not found.`);
export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(HttpStatus.CONFLICT, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
