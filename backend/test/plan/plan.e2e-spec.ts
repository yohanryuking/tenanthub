import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';

/**
 * Sprint 5: plan gating. GET /tasks/export.csv is the one feature actually
 * behind PlanGuard/@RequiresPlan('pro') — everything else here exercises
 * the mechanics (who can change the plan, and how fast the gate reacts to
 * that change) around it.
 */

let app: INestApplication;
let admin: PrismaClient;

const suffix = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  admin = new PrismaClient();
});

afterAll(async () => {
  await admin.organization.deleteMany({ where: { slug: { startsWith: 'e2e-plan-' } } });
  await admin.$disconnect();
  await app.close();
});

async function registerOrg() {
  const slug = `e2e-plan-${suffix()}`;
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({
      orgName: `E2E Plan Org ${slug}`,
      orgSlug: slug,
      email: `admin-${slug}@e2e.test`,
      password: 'password123',
    });
  return { slug, accessToken: res.body.accessToken, refreshToken: res.body.refreshToken };
}

async function inviteAndAccept(adminAccessToken: string) {
  const email = `invitee-${suffix()}@e2e.test`;
  const invite = await request(app.getHttpServer())
    .post('/organizations/invitations')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ email, role: 'member' });
  const accept = await request(app.getHttpServer())
    .post(`/auth/invitations/${invite.body.token}/accept`)
    .send({ password: 'password123' });
  return accept.body.accessToken as string;
}

describe('Plan gating (e2e)', () => {
  it('blocks the pro-only CSV export on a free org', async () => {
    const org = await registerOrg();
    const res = await request(app.getHttpServer())
      .get('/tasks/export.csv')
      .set('Authorization', `Bearer ${org.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('allows the export once the org is on pro and the token is refreshed', async () => {
    const org = await registerOrg();
    await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ title: 'Exportable task' });

    const upgrade = await request(app.getHttpServer())
      .patch('/organizations/plan')
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ plan: 'pro' });
    expect(upgrade.status).toBe(200);
    expect(upgrade.body.plan).toBe('pro');

    // Stale token still says "free" — the gate doesn't trust the DB on
    // every request, it trusts the JWT, so it still blocks here.
    const staleAttempt = await request(app.getHttpServer())
      .get('/tasks/export.csv')
      .set('Authorization', `Bearer ${org.accessToken}`);
    expect(staleAttempt.status).toBe(403);

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: org.refreshToken });

    const freshAttempt = await request(app.getHttpServer())
      .get('/tasks/export.csv')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`);
    expect(freshAttempt.status).toBe(200);
    expect(freshAttempt.headers['content-type']).toContain('text/csv');
    expect(freshAttempt.text).toContain('Exportable task');
  });

  it('forbids a non-admin from changing the plan', async () => {
    const org = await registerOrg();
    const memberAccessToken = await inviteAndAccept(org.accessToken);

    const res = await request(app.getHttpServer())
      .patch('/organizations/plan')
      .set('Authorization', `Bearer ${memberAccessToken}`)
      .send({ plan: 'pro' });
    expect(res.status).toBe(403);
  });
});
