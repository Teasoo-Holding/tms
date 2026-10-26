import { DeletionController } from './deletion.controller';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { GeographyController } from './geography.controller';
import { ProjectsController } from './projects.controller';
import { ReferenceController } from './reference.controller';
import { SpeciesImagesController } from './species-images.controller';
import { UsersController } from './users.controller';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [ProjectsController, GeographyController, ReferenceController, UsersController, DeletionController, SpeciesImagesController],
})
export class AdminModule {}
