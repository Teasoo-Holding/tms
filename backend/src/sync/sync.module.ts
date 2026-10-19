import { Module } from '@nestjs/common';
import { TreesModule } from '../trees/trees.module';
import { SyncController } from './sync.controller';
import { SyncDataService } from './sync-data.service';
import { SyncService } from './sync.service';

@Module({ imports: [TreesModule], controllers: [SyncController], providers: [SyncService, SyncDataService] })
export class SyncModule {}
