import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';
import { parse } from '../common/validation';
import { Db } from '../database/db.service';
import { AuthService } from './auth.service';

const LoginBody = z.object({
  /** Username, email or phone number. */
  login: z.string().trim().min(1).max(200).optional(),
  /** Older app versions send the email here. */
  email: z.string().trim().min(1).max(200).optional(),
  password: z.string().min(1).max(200),
  device_id: z.string().uuid().optional(),
  device_name: z.string().max(100).optional(),
  app_version: z.string().max(40).optional(),
});
const RefreshBody = z.object({ refresh_token: z.string().min(10).max(200) });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly db: Db) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown) {
    const b = parse(LoginBody, body);
    return this.auth.login(b.login ?? b.email ?? '', b.password, { deviceId: b.device_id, deviceName: b.device_name, appVersion: b.app_version });
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown) {
    return this.auth.refresh(parse(RefreshBody, body).refresh_token);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: unknown) {
    await this.auth.logout(parse(RefreshBody, body).refresh_token);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return this.db.one(this.db, 'SELECT id, email, username, phone, full_name, role, active FROM users WHERE id = $1', [user.id]);
  }
}
