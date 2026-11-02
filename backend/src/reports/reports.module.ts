import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ReportsController } from './reports.controller';
import { ShareController } from './share.controller';
import { ReportsService } from './reports.service';

@Module({ imports: [MediaModule], controllers: [ReportsController, ShareController], providers: [ReportsService] })
export class ReportsModule {}
