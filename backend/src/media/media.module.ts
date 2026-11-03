import { DataMaintenanceController } from './data-maintenance.controller';
import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { createObjectStorage, OBJECT_STORAGE } from './storage';

@Module({
  controllers: [MediaController, DataMaintenanceController],
  providers: [MediaService, { provide: OBJECT_STORAGE, useFactory: createObjectStorage }],
  exports: [MediaService, OBJECT_STORAGE],
})
export class MediaModule {}
