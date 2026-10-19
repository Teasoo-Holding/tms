import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';

@Global()
@Module({ providers: [AccessService, AuditService], exports: [AccessService, AuditService] })
export class CommonModule {}
