import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { HeightController } from './height.controller';
import { HeightService } from './height.service';

@Module({ imports: [MediaModule], controllers: [HeightController], providers: [HeightService] })
export class HeightModule {}
