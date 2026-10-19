import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './common/auth.guard';
import { CommonModule } from './common/common.module';
import { ConflictsModule } from './conflicts/conflicts.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { MediaModule } from './media/media.module';
import { ReportsModule } from './reports/reports.module';
import { SyncModule } from './sync/sync.module';
import { TreesModule } from './trees/trees.module';

@Module({
  imports: [
    DatabaseModule,
    CommonModule,
    JwtModule.register({ global: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    AuthModule,
    AdminModule,
    TreesModule,
    MediaModule,
    SyncModule,
    ConflictsModule,
    ReportsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
