import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { TenantModule } from './common/tenant/tenant.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    TenantModule,
    AuthModule,
    TasksModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
