import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/auth.decorators';
import { parse } from '../common/validation';
import { Points } from './ai';
import { HeightService, REFERENCE_STICKS } from './height.service';

const EstimateBody = z.object({ media_id: z.string().uuid().optional() });
const ConfirmBody = z.object({ points: Points.optional(), height_cm: z.number().positive().max(10000).optional() });

/** Tree height estimates from photos, for administrators (#109). */
@Roles('ADMIN')
@Controller()
export class HeightController {
  constructor(private readonly heights: HeightService) {}

  @Get('height-estimates/status')
  status() {
    return { enabled: this.heights.enabled, reference_sticks: REFERENCE_STICKS };
  }

  @Get('trees/:id/height-estimates')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.heights.list(id);
  }

  @Post('trees/:id/height-estimates')
  estimate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.heights.estimate(user, id, parse(EstimateBody, body ?? {}).media_id);
  }

  @Post('height-estimates/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(ConfirmBody, body ?? {});
    return this.heights.confirm(user, id, b.points, b.height_cm);
  }

  @Post('height-estimates/:id/discard')
  @HttpCode(200)
  discard(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.heights.discard(user, id);
  }
}
