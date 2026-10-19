import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { config } from '../config';
import { Db, Queryable } from '../database/db.service';
import { AppError } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { verifyPassword } from './passwords';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
// Verifying against a dummy hash keeps response time similar for unknown accounts.
const DUMMY_HASH = '$argon2id$v=19$m=19456,p=1,t=2$M7rV6KVwVTKU/Ygmy4To0A$5qZD1usDsF2m4TCqVJAwf4qwApH0LlYfbX+oQ/ZAowM';

export interface DeviceInfo {
  deviceId?: string;
  deviceName?: string;
  appVersion?: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly db: Db, private readonly jwt: JwtService, private readonly audit: AuditService) {}

  async login(email: string, password: string, device: DeviceInfo) {
    const user = await this.db.one(this.db, 'SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
    const ok = await verifyPassword(user?.password_hash ?? DUMMY_HASH, password);
    if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    if (!user.active) throw new AppError(401, 'ACCOUNT_DISABLED', 'This account has been deactivated.');

    return this.db.tx(async (tx) => {
      if (device.deviceId) await this.registerDevice(tx, user.id, device);
      await this.audit.record({ actorId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, metadata: { deviceId: device.deviceId } }, tx);
      return this.issue(tx, user, device.deviceId ?? null, randomUUID());
    });
  }

  /** Rotating refresh tokens; presenting an already-used token revokes the whole family. */
  async refresh(refreshToken: string) {
    const result = await this.db.tx(async (tx) => {
      const session = await this.db.one(tx, 'SELECT * FROM refresh_sessions WHERE token_hash = $1 FOR UPDATE', [sha256(refreshToken)]);
      if (!session) throw new AppError(401, 'SESSION_INVALID', 'Your session is no longer valid. Sign in again.');
      if (session.used_at || session.revoked_at) {
        // Possible token theft: revoke the family. Returned (not thrown) so the revocation commits.
        await tx.query('UPDATE refresh_sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [session.family_id]);
        return null;
      }
      if (new Date(session.expires_at) < new Date()) throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Sign in again.');
      const user = await this.db.one(tx, 'SELECT * FROM users WHERE id = $1', [session.user_id]);
      if (!user?.active) throw new AppError(401, 'ACCOUNT_DISABLED', 'This account has been deactivated.');
      if (session.device_id) {
        const device = await this.db.one(tx, 'SELECT revoked_at FROM devices WHERE id = $1', [session.device_id]);
        if (device?.revoked_at) throw new AppError(401, 'DEVICE_REVOKED', 'This device has been revoked. Contact an administrator.');
        await tx.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [session.device_id]);
      }
      await tx.query('UPDATE refresh_sessions SET used_at = now() WHERE id = $1', [session.id]);
      return this.issue(tx, user, session.device_id, session.family_id);
    });
    if (!result) throw new AppError(401, 'SESSION_INVALID', 'Your session is no longer valid. Sign in again.');
    return result;
  }

  async logout(refreshToken: string) {
    const session = await this.db.one(this.db, 'SELECT family_id FROM refresh_sessions WHERE token_hash = $1', [sha256(refreshToken)]);
    if (session) await this.db.query('UPDATE refresh_sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [session.family_id]);
  }

  async revokeAllForUser(q: Queryable, userId: string) {
    await q.query('UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  }

  private async registerDevice(q: Queryable, userId: string, d: DeviceInfo) {
    const existing = await this.db.one(q, 'SELECT user_id, revoked_at FROM devices WHERE id = $1', [d.deviceId]);
    if (existing?.revoked_at) throw new AppError(401, 'DEVICE_REVOKED', 'This device has been revoked. Contact an administrator.');
    if (existing) {
      // A shared device may be used by different officers; the latest sign-in owns it.
      await q.query('UPDATE devices SET user_id = $2, name = COALESCE($3, name), app_version = COALESCE($4, app_version), last_seen_at = now() WHERE id = $1', [
        d.deviceId,
        userId,
        d.deviceName ?? null,
        d.appVersion ?? null,
      ]);
    } else {
      await q.query('INSERT INTO devices (id, user_id, name, app_version, last_seen_at) VALUES ($1, $2, $3, $4, now())', [
        d.deviceId,
        userId,
        d.deviceName ?? null,
        d.appVersion ?? null,
      ]);
    }
  }

  private async issue(q: Queryable, user: any, deviceId: string | null, familyId: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role, ...(deviceId ? { did: deviceId } : {}) },
      { secret: config.jwtAccessSecret, expiresIn: config.accessTokenTtlSeconds },
    );
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpires = new Date(Date.now() + config.refreshTokenTtlDays * 86400_000);
    await q.query(
      'INSERT INTO refresh_sessions (user_id, device_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5)',
      [user.id, deviceId, familyId, sha256(refreshToken), refreshExpires],
    );
    return {
      access_token: accessToken,
      access_token_expires_in: config.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      refresh_token_expires_at: refreshExpires.toISOString(),
      // The device may keep working offline until this time; then it must revalidate online.
      offline_valid_until: new Date(Date.now() + config.offlineSessionDays * 86400_000).toISOString(),
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
    };
  }
}
