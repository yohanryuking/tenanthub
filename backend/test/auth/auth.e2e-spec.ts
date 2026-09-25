import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';

/**
 * End-to-end tests for the Sprint 2 auth flows (register, login, org
 * picker, invitations, refresh rotation) driven entirely over HTTP against
 * a real running Nest app + real Postgres — the same instance test/rls
 * exercises directly with SQL. These complement, not replace, the negative
 * RLS tests: this file asserts the API contract behaves correctly; test/rls
 * asserts the database can't be tricked even if the API layer had a bug.
 */

let app: INestApplication;
let admin: PrismaClient; // schema-owner client, used only for fixture cleanup

const suffix = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  admin = new PrismaClient(); // uses DATABASE_URL (owner role) via schema default
});

afterAll(async () => {
  // Scoped to this file's own prefix, and users are left alone — every
  // e2e suite shares the @e2e.test email domain and runs concurrently
  // (Jest parallelizes across files), so a broader user.deleteMany() here
  // previously cascade-deleted other suites' live memberships/audit rows
  // mid-run. Each suite cleaning only its own orgs is what keeps them
  // from stepping on each other.
  await admin.organization.deleteMany({ where: { slug: { startsWith: 'e2e-auth-' } } });
  await admin.$disconnect();
  await app.close();
});

function registerOrg() {
  const slug = `e2e-auth-${suffix()}`;
  return request(app.getHttpServer())
    .post('/auth/register')
    .send({
      orgName: `E2E Org ${slug}`,
      orgSlug: slug,
      email: `admin-${slug}@e2e.test`,
      password: 'password123',
    })
    .then((res) => ({ res, slug, email: `admin-${slug}@e2e.test` }));
}

describe('Auth flows (e2e)', () => {
  it('registers a new org with an admin membership and returns tokens', async () => {
    const { res } = await registerOrg();
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
  });

  it('rejects a duplicate org slug on register', async () => {
    const { slug } = await registerOrg();
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        orgName: 'Whatever',
        orgSlug: slug,
        email: `other-${suffix()}@e2e.test`,
        password: 'password123',
      });
    expect(res.status).toBe(409);
  });

  it('rejects login with the wrong password', async () => {
    const { slug, email } = await registerOrg();
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'wrong-password', orgSlug: slug });
    expect(res.status).toBe(401);
  });

  it('lists the orgs a given email belongs to', async () => {
    const { slug, email } = await registerOrg();
    const res = await request(app.getHttpServer()).get('/auth/orgs').query({ email });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ org_slug: slug }),
    ]);
  });

  it('rejects requests without a token', async () => {
    const res = await request(app.getHttpServer()).get('/tasks');
    expect(res.status).toBe(401);
  });

  describe('invitations', () => {
    it('lets an admin invite, and the invitee accept and log in', async () => {
      const { res: reg, slug } = await registerOrg();
      const adminToken = reg.body.accessToken;
      const inviteeEmail = `invitee-${suffix()}@e2e.test`;

      const invite = await request(app.getHttpServer())
        .post('/organizations/invitations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: inviteeEmail, role: 'member' });
      expect(invite.status).toBe(201);
      const token = invite.body.token;

      const accept = await request(app.getHttpServer())
        .post(`/auth/invitations/${token}/accept`)
        .send({ password: 'inviteepass1' });
      expect(accept.status).toBe(200);
      expect(accept.body.accessToken).toEqual(expect.any(String));

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: inviteeEmail, password: 'inviteepass1', orgSlug: slug });
      expect(login.status).toBe(200);

      // Re-accepting the same (now consumed) token must fail.
      const reaccept = await request(app.getHttpServer())
        .post(`/auth/invitations/${token}/accept`)
        .send({ password: 'inviteepass1' });
      expect(reaccept.status).toBe(410);
    });

    it('forbids a non-admin (member) from creating an invitation', async () => {
      const { res: reg, slug } = await registerOrg();
      const adminToken = reg.body.accessToken;
      const memberEmail = `member-${suffix()}@e2e.test`;

      const invite = await request(app.getHttpServer())
        .post('/organizations/invitations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: memberEmail, role: 'member' });
      const memberAccept = await request(app.getHttpServer())
        .post(`/auth/invitations/${invite.body.token}/accept`)
        .send({ password: 'memberpass1' });
      const memberToken = memberAccept.body.accessToken;

      const forbidden = await request(app.getHttpServer())
        .post('/organizations/invitations')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ email: `another-${suffix()}@e2e.test` });
      expect(forbidden.status).toBe(403);

      void slug;
    });

    it('rejects an unknown invitation token', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/invitations/not-a-real-token/accept')
        .send({ password: 'whatever12' });
      expect(res.status).toBe(404);
    });
  });

  describe('refresh token rotation', () => {
    it('rotates the refresh token and invalidates the previous one', async () => {
      const { res: reg } = await registerOrg();
      const firstRefresh = reg.body.refreshToken;

      const refreshed = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: firstRefresh });
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.refreshToken).not.toBe(firstRefresh);

      const reuse = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: firstRefresh });
      expect(reuse.status).toBe(401);
    });

    it('revokes the refresh token on logout', async () => {
      const { res: reg } = await registerOrg();
      const { refreshToken } = reg.body;

      const logout = await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken });
      expect(logout.status).toBe(204);

      const afterLogout = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken });
      expect(afterLogout.status).toBe(401);
    });
  });

  describe('cross-tenant isolation over HTTP (API-level regression of the RLS guarantee)', () => {
    it('org A never sees org B tasks through the API, even with a valid token', async () => {
      const { res: regA } = await registerOrg();
      const { res: regB } = await registerOrg();

      await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${regB.body.accessToken}`)
        .send({ title: 'Org B secret task' });

      const listA = await request(app.getHttpServer())
        .get('/tasks')
        .set('Authorization', `Bearer ${regA.body.accessToken}`);

      expect(listA.status).toBe(200);
      expect(listA.body.items).toEqual([]);
      expect(listA.body.total).toBe(0);
    });
  });
});
