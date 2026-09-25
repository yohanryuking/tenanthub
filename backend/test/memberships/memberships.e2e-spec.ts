import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';

/**
 * Sprint 4: RolesGuard-backed authorization on /memberships, and the
 * invariant that an organization can never end up with zero admins. Each
 * test that needs the "member becomes admin" transition to actually bite
 * also refreshes that member's token afterwards — role changes are only
 * visible in a JWT from the moment it's (re)issued, since
 * auth_consume_refresh_token re-reads the role from the DB on every
 * refresh (see docs/architecture.md).
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
  await admin.organization.deleteMany({ where: { slug: { startsWith: 'e2e-mem-' } } });
  await admin.$disconnect();
  await app.close();
});

async function registerOrg() {
  const slug = `e2e-mem-${suffix()}`;
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({
      orgName: `E2E Memberships Org ${slug}`,
      orgSlug: slug,
      email: `admin-${slug}@e2e.test`,
      password: 'password123',
    });
  return { slug, accessToken: res.body.accessToken, refreshToken: res.body.refreshToken };
}

async function inviteAndAccept(adminAccessToken: string, role: 'admin' | 'member' = 'member') {
  const email = `invitee-${suffix()}@e2e.test`;
  const invite = await request(app.getHttpServer())
    .post('/organizations/invitations')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ email, role });
  const accept = await request(app.getHttpServer())
    .post(`/auth/invitations/${invite.body.token}/accept`)
    .send({ password: 'password123' });
  return {
    accessToken: accept.body.accessToken as string,
    refreshToken: accept.body.refreshToken as string,
  };
}

async function refreshAccessToken(refreshToken: string) {
  const res = await request(app.getHttpServer())
    .post('/auth/refresh')
    .send({ refreshToken });
  return res.body.accessToken as string;
}

describe('Memberships & roles (e2e)', () => {
  it('lists all memberships of the caller’s org, regardless of role', async () => {
    const org = await registerOrg();
    const member = await inviteAndAccept(org.accessToken);

    const asAdmin = await request(app.getHttpServer())
      .get('/memberships')
      .set('Authorization', `Bearer ${org.accessToken}`);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body).toHaveLength(2);

    const asMember = await request(app.getHttpServer())
      .get('/memberships')
      .set('Authorization', `Bearer ${member.accessToken}`);
    expect(asMember.status).toBe(200);
    expect(asMember.body).toHaveLength(2);
  });

  it('forbids a member from changing anyone’s role', async () => {
    const org = await registerOrg();
    const member = await inviteAndAccept(org.accessToken);
    const list = await request(app.getHttpServer())
      .get('/memberships')
      .set('Authorization', `Bearer ${org.accessToken}`);
    const memberRow = list.body.find((m: { role: string }) => m.role === 'member');

    const res = await request(app.getHttpServer())
      .patch(`/memberships/${memberRow.id}`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ role: 'admin' });
    expect(res.status).toBe(403);
  });

  it('lets an admin promote a member, and the change takes effect after refresh', async () => {
    const org = await registerOrg();
    const member = await inviteAndAccept(org.accessToken);
    const list = await request(app.getHttpServer())
      .get('/memberships')
      .set('Authorization', `Bearer ${org.accessToken}`);
    const memberRow = list.body.find((m: { role: string }) => m.role === 'member');

    const promote = await request(app.getHttpServer())
      .patch(`/memberships/${memberRow.id}`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ role: 'admin' });
    expect(promote.status).toBe(200);
    expect(promote.body.role).toBe('admin');

    // Old token still says "member" until refreshed.
    const inviteAttemptWithStaleToken = await request(app.getHttpServer())
      .post('/organizations/invitations')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ email: `stale-${suffix()}@e2e.test` });
    expect(inviteAttemptWithStaleToken.status).toBe(403);

    const freshMemberAccessToken = await refreshAccessToken(member.refreshToken);
    const inviteAttemptWithFreshToken = await request(app.getHttpServer())
      .post('/organizations/invitations')
      .set('Authorization', `Bearer ${freshMemberAccessToken}`)
      .send({ email: `fresh-${suffix()}@e2e.test` });
    expect(inviteAttemptWithFreshToken.status).toBe(201);
  });

  it('blocks demoting the sole admin of an org, but allows it once there are two', async () => {
    const org = await registerOrg();
    const member = await inviteAndAccept(org.accessToken);
    const list = await request(app.getHttpServer())
      .get('/memberships')
      .set('Authorization', `Bearer ${org.accessToken}`);
    const memberRow = list.body.find((m: { role: string }) => m.role === 'member');
    const adminRow = list.body.find((m: { role: string }) => m.role === 'admin');

    // Sole admin cannot demote themselves.
    const soleAdminDemote = await request(app.getHttpServer())
      .patch(`/memberships/${adminRow.id}`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ role: 'member' });
    expect(soleAdminDemote.status).toBe(409);

    const stillAdmin = await admin.membership.findUnique({ where: { id: adminRow.id } });
    expect(stillAdmin?.role).toBe('admin');

    // Promote the member to admin — now there are two.
    await request(app.getHttpServer())
      .patch(`/memberships/${memberRow.id}`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ role: 'admin' });

    // The original admin can now demote themselves.
    const demote = await request(app.getHttpServer())
      .patch(`/memberships/${adminRow.id}`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ role: 'member' });
    expect(demote.status).toBe(200);
    expect(demote.body.role).toBe('member');

    // The remaining (now sole) admin cannot demote themselves either, once
    // their token reflects the promotion.
    const freshMemberAccessToken = await refreshAccessToken(member.refreshToken);
    const secondSoleAdminDemote = await request(app.getHttpServer())
      .patch(`/memberships/${memberRow.id}`)
      .set('Authorization', `Bearer ${freshMemberAccessToken}`)
      .send({ role: 'member' });
    expect(secondSoleAdminDemote.status).toBe(409);
  });

  it('returns 404 (never 403) when an admin guesses a membership id from another org', async () => {
    const orgA = await registerOrg();
    const orgB = await registerOrg();
    const listB = await request(app.getHttpServer())
      .get('/memberships')
      .set('Authorization', `Bearer ${orgB.accessToken}`);
    const orgBMembershipId = listB.body[0].id;

    const res = await request(app.getHttpServer())
      .patch(`/memberships/${orgBMembershipId}`)
      .set('Authorization', `Bearer ${orgA.accessToken}`)
      .send({ role: 'admin' });
    expect(res.status).toBe(404);
  });
});
