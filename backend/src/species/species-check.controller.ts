import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { parse } from '../common/validation';
import { SpeciesCheckService } from './species-check.service';

const ListQuery = z.object({
  project_id: z.string().uuid().optional(),
  state: z.enum(['open', 'reviewed', 'all']).default('open'),
  verdict: z.enum(['AGREE', 'DISAGREE', 'UNSURE']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const ReviewBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }),
  z.object({ action: z.literal('correct'), species_id: z.string().uuid() }),
]);

/** Species check results and their review, for administrators (#101). */
@Roles('ADMIN')
@Controller('species-checks')
export class SpeciesCheckController {
  constructor(private readonly checks: SpeciesCheckService) {}

  @Get('status')
  status() {
    return this.checks.status();
  }

  @Get('agreement')
  agreement(@Query('project_id') projectId?: string) {
    return this.checks.agreement(parse(z.string().uuid().optional(), projectId || undefined));
  }

  @Get()
  list(@Query() q: unknown) {
    return this.checks.list(parse(ListQuery, q));
  }

  @Post(':id/review')
  @HttpCode(200)
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(ReviewBody, body);
    return this.checks.review(user, id, b.action, b.action === 'correct' ? b.species_id : undefined);
  }
}
