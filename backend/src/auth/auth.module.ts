import { Module } from '@nestjs/common';
import { TenantModule } from '../common/tenant/tenant.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [TenantModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
