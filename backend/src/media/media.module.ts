import { DataMaintenanceController } from './data-maintenance.controller';
import { Module } from '@nestjs/common';
import { config } from '../config';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { LocalStorage, OBJECT_STORAGE, S3Storage } from './storage';

@Module({
  controllers: [MediaController, DataMaintenanceController],
  providers: [MediaService, { provide: OBJECT_STORAGE, useFactory: () => (config.storageDriver === 's3' ? new S3Storage() : new LocalStorage()) }],
  exports: [MediaService, OBJECT_STORAGE],
})
export class MediaModule {}
