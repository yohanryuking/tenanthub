import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { TenantClaims } from '../common/tenant/tenant.types';
import { RequiresPlan } from '../common/plan/plan.decorator';
import { PlanGuard } from '../common/plan/plan.guard';
import { Audit } from '../common/audit/audit.decorator';
import { AuditInterceptor } from '../common/audit/audit.interceptor';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  findAll(@Query() query: ListTasksQueryDto) {
    return this.tasksService.findAll(query);
  }

  // Declared before the export route only for readability — Nest matches
  // by exact path, so `/tasks/export.csv` never collides with `/tasks`.
  @RequiresPlan('pro')
  @UseGuards(PlanGuard)
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="tasks.csv"')
  @Get('export.csv')
  exportCsv() {
    return this.tasksService.exportCsv();
  }

  @Post()
  create(@Body() dto: CreateTaskDto, @CurrentTenant() tenant: TenantClaims) {
    return this.tasksService.create(dto, tenant);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasksService.update(id, dto);
  }

  @Audit('task.deleted', 'task')
  @UseInterceptors(AuditInterceptor)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.tasksService.remove(id);
  }
}
