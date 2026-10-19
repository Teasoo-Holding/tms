import { Module } from '@nestjs/common';
import { TreesModule } from '../trees/trees.module';
import { ConflictsController } from './conflicts.controller';

@Module({ imports: [TreesModule], controllers: [ConflictsController] })
export class ConflictsModule {}
