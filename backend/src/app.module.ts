import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { TenantModule } from './common/tenant/tenant.module';
import { AuditModule } from './common/audit/audit.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { TasksModule } from './tasks/tasks.module';
import { OrganizationsModule } from './organizations/organizations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    TenantModule,
    AuditModule,
    AuthModule,
    TasksModule,
    OrganizationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
