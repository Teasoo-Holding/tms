import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GeographyController } from './geography.controller';
import { ProjectsController } from './projects.controller';
import { ReferenceController } from './reference.controller';
import { UsersController } from './users.controller';

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController, GeographyController, ReferenceController, UsersController],
})
export class AdminModule {}
