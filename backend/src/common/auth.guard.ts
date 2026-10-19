import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { config } from '../config';
import { Db } from '../database/db.service';
import { AppError, forbidden } from './errors';
import { IS_PUBLIC, Role, ROLES } from './auth.decorators';

/**
 * Global guard: every route requires a valid access token and an active account
 * unless marked @Public(). Role restrictions come from @Roles().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(header.slice(7), { secret: config.jwtAccessSecret });
    } catch {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Your session has expired. Refresh it or sign in again.');
    }
    // Revocation takes effect on the next online request, not only at token expiry.
    const user = await this.db.one(this.db, 'SELECT id, role, active FROM users WHERE id = $1', [payload.sub]);
    if (!user || !user.active) throw new AppError(401, 'ACCOUNT_DISABLED', 'This account has been deactivated.');
    if (payload.did) {
      const device = await this.db.one(this.db, 'SELECT revoked_at FROM devices WHERE id = $1', [payload.did]);
      if (device?.revoked_at) throw new AppError(401, 'DEVICE_REVOKED', 'This device has been revoked. Contact an administrator.');
    }
    req.user = { id: user.id, role: user.role, deviceId: payload.did };

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (roles && !roles.includes(user.role)) throw forbidden();
    return true;
  }
}
