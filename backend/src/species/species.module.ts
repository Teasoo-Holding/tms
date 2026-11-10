import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { TreesModule } from '../trees/trees.module';
import { SpeciesCheckController } from './species-check.controller';
import { SpeciesCheckService } from './species-check.service';

@Module({ imports: [TreesModule, MediaModule], controllers: [SpeciesCheckController], providers: [SpeciesCheckService], exports: [SpeciesCheckService] })
export class SpeciesModule {}
