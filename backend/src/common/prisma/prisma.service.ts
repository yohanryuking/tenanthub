import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Connects with APP_DATABASE_URL — the non-owner `tenanthub_app` role that
 * RLS actually applies to. DATABASE_URL (the owner/superuser role) is only
 * ever used by the Prisma CLI for migrations, never by the running app.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const url = process.env.APP_DATABASE_URL;
    if (!url) {
      throw new Error(
        'APP_DATABASE_URL is not set. The app must not fall back to DATABASE_URL, ' +
          'which points at a role that bypasses Row-Level Security.',
      );
    }
    super({ datasources: { db: { url } } });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL as tenanthub_app (RLS-scoped)');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
