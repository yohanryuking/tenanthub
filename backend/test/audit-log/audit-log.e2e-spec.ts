import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';

/**
 * Sprint 5: every sensitive action the roadmap lists (login, plan change,
 * invitation, role change, task deletion) actually leaves a row, scoped to
 * the right org, readable only by an admin. This is the functional
 * counterpart to the RLS-level audit_log tests in test/rls — those prove
 * the database can't be tricked; these prove the application actually
 * writes what it's supposed to.
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
  await admin.organization.deleteMany({ where: { slug: { startsWith: 'e2e-audit-' } } });
  await admin.$disconnect();
  await app.close();
});

async function registerOrg() {
  const slug = `e2e-audit-${suffix()}`;
  const email = `admin-${slug}@e2e.test`;
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ orgName: `E2E Audit Org ${slug}`, orgSlug: slug, email, password: 'password123' });
  return { slug, email, accessToken: res.body.accessToken, refreshToken: res.body.refreshToken };
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

describe('Audit log (e2e)', () => {
  it('records login, plan change, invitation, role change and task deletion', async () => {
    const org = await registerOrg();

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: org.email, password: 'password123', orgSlug: org.slug });

    const task = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ title: 'To be deleted' });

    await request(app.getHttpServer())
      .patch('/organizations/plan')
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ plan: 'pro' });

    const memberAccessToken = await inviteAndAccept(org.accessToken);
    const memberships = await request(app.getHttpServer())
      .get('/memberships')
      .set('Authorization', `Bearer ${org.accessToken}`);
    const memberRow = memberships.body.find((m: { role: string }) => m.role === 'member');

    await request(app.getHttpServer())
      .patch(`/memberships/${memberRow.id}`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ role: 'admin' });

    await request(app.getHttpServer())
      .delete(`/tasks/${task.body.id}`)
      .set('Authorization', `Bearer ${org.accessToken}`);

    const auditLog = await request(app.getHttpServer())
      .get('/audit-log')
      .set('Authorization', `Bearer ${org.accessToken}`);

    expect(auditLog.status).toBe(200);
    const actions = auditLog.body.items.map((entry: { action: string }) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'auth.login',
        'organization.plan_changed',
        'invitation.created',
        'membership.role_changed',
        'task.deleted',
      ]),
    );

    const planEntry = auditLog.body.items.find(
      (e: { action: string }) => e.action === 'organization.plan_changed',
    );
    expect(planEntry.actorId).toBeDefined();
    expect(planEntry.actor.email).toBe(org.email);

    void memberAccessToken;
  });

  it('forbids a member from reading the audit log', async () => {
    const org = await registerOrg();
    const memberAccessToken = await inviteAndAccept(org.accessToken);

    const res = await request(app.getHttpServer())
      .get('/audit-log')
      .set('Authorization', `Bearer ${memberAccessToken}`);
    expect(res.status).toBe(403);
  });

  it("never mixes one org's audit entries into another's", async () => {
    const orgA = await registerOrg();
    const orgB = await registerOrg();

    await request(app.getHttpServer())
      .patch('/organizations/plan')
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .send({ plan: 'pro' });

    const auditA = await request(app.getHttpServer())
      .get('/audit-log')
      .set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(
      auditA.body.items.some((e: { action: string }) => e.action === 'organization.plan_changed'),
    ).toBe(false);
  });
});
