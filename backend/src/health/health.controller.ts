import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/tenant/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok', service: 'tenanthub-backend' };
  }
}
