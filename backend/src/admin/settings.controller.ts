import { Body, Controller, Get, Patch } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/validation';
import { Db } from '../database/db.service';
import { readSettings, SettingsPatch } from '../domain/settings';

/** Organisation-wide defaults. Phones receive them with their configuration and every change-feed page. */
@Roles('ADMIN')
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  @Get()
  get() {
    return readSettings(this.db);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const b = parse(SettingsPatch, body);
    return this.db.tx(async (tx) => {
      const before = await readSettings(tx);
      for (const [key, value] of Object.entries(b)) {
        await tx.query(
          `INSERT INTO system_settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [key, value],
        );
      }
      const after = await readSettings(tx);
      await this.audit.record({ actorId: user.id, action: 'settings.update', entityType: 'system', before, after }, tx);
      return after;
    });
  }
}
