import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { AccessService } from '../common/access.service';
import { parse } from '../common/validation';
import { config } from '../config';
import { BatchBody, SyncService } from './sync.service';
import { SyncDataService } from './sync-data.service';

const ChangesQuery = z.object({
  cursor: z.string().regex(/^\d+$/).default('0'),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});
const TreesQuery = z.object({
  project_id: z.string().uuid(),
  after_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

@Roles('ADMIN', 'FIELD_OFFICER')
@Controller()
export class SyncController {
  constructor(private readonly sync: SyncService, private readonly data: SyncDataService, private readonly access: AccessService) {}

  @Get('mobile/bootstrap')
  bootstrap(@CurrentUser() user: AuthUser) {
    return this.data.bootstrap(user);
  }

  @Get('mobile/trees')
  async trees(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const q = parse(TreesQuery, query);
    await this.access.assertProject(user, q.project_id);
    return this.data.trees(user, q.project_id, q.after_id ?? null, q.limit);
  }

  @Post('sync/batches')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.sync.submitBatch(user, parse(BatchBody, body));
  }

  @Get('sync/changes')
  changes(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const q = parse(ChangesQuery, query);
    return this.data.changes(user, Number(q.cursor), q.limit ?? config.changesPageSize);
  }
}
