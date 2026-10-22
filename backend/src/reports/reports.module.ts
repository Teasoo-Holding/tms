import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ShareController } from './share.controller';
import { ReportsService } from './reports.service';

@Module({ controllers: [ReportsController, ShareController], providers: [ReportsService] })
export class ReportsModule {}
