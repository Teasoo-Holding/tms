import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/auth.decorators';
import { Db } from '../database/db.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: Db) {}

  @Public()
  @Get()
  async health() {
    await this.db.query('SELECT 1');
    return { status: 'ok', time: new Date().toISOString() };
  }

  /** Operational metrics for monitoring/alerting (architecture §12). */
  @Get('metrics')
  async metrics() {
    const { rows } = await this.db.query(`
      SELECT (SELECT count(*) FROM conflict_records WHERE status = 'OPEN')::int AS open_conflicts,
             (SELECT count(*) FROM tree_media WHERE upload_state = 'FAILED')::int AS failed_media_verifications,
             (SELECT count(*) FROM tree_media WHERE upload_state = 'PENDING' AND created_at < now() - interval '1 day')::int AS stale_pending_media,
             (SELECT count(*) FROM sync_operations WHERE result_status = 'REJECTED' AND processed_at > now() - interval '1 day')::int AS rejected_ops_24h,
             (SELECT count(*) FROM sync_operations WHERE processed_at > now() - interval '1 day')::int AS ops_24h,
             (SELECT count(*) FROM devices WHERE revoked_at IS NULL AND last_sync_at > now() - interval '7 days')::int AS active_devices_7d,
             (SELECT json_agg(json_build_object('app_version', app_version, 'devices', c)) FROM
                (SELECT app_version, count(*) AS c FROM devices WHERE revoked_at IS NULL GROUP BY app_version) v) AS app_versions`);
    return rows[0];
  }
}
