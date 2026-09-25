import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { AuditInterceptor } from './audit.interceptor';

@Global()
@Module({
  providers: [AuditLogService, AuditInterceptor],
  exports: [AuditLogService, AuditInterceptor],
})
export class AuditModule {}
