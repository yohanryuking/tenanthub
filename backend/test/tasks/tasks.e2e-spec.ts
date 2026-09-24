import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';

/**
 * Sprint 3: pagination/filters on GET /tasks, PATCH/DELETE /tasks/:id, and
 * the property that matters most from a security standpoint — a task id
 * from another organization returns 404, the exact same response as an id
 * that never existed. Returning 403 instead would leak that the row
 * exists, just not to you; RLS hides the row entirely, so the API must
 * not contradict that by distinguishing the two cases.
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
  await admin.organization.deleteMany({ where: { slug: { startsWith: 'e2e-tasks-' } } });
  await admin.$disconnect();
  await app.close();
});

async function registerOrgWithAccessToken() {
  const slug = `e2e-tasks-${suffix()}`;
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({
      orgName: `E2E Tasks Org ${slug}`,
      orgSlug: slug,
      email: `admin-${slug}@e2e.test`,
      password: 'password123',
    });
  return res.body.accessToken as string;
}

function createTask(token: string, title: string) {
  return request(app.getHttpServer())
    .post('/tasks')
    .set('Authorization', `Bearer ${token}`)
    .send({ title });
}

describe('Tasks CRUD (e2e)', () => {
  it('paginates results', async () => {
    const token = await registerOrgWithAccessToken();
    await createTask(token, 'Task A');
    await createTask(token, 'Task B');
    await createTask(token, 'Task C');

    const page1 = await request(app.getHttpServer())
      .get('/tasks')
      .query({ page: 1, pageSize: 2 })
      .set('Authorization', `Bearer ${token}`);

    expect(page1.status).toBe(200);
    expect(page1.body.total).toBe(3);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.page).toBe(1);
    expect(page1.body.pageSize).toBe(2);

    const page2 = await request(app.getHttpServer())
      .get('/tasks')
      .query({ page: 2, pageSize: 2 })
      .set('Authorization', `Bearer ${token}`);
    expect(page2.body.items).toHaveLength(1);
  });

  it('filters by text and by done status', async () => {
    const token = await registerOrgWithAccessToken();
    await createTask(token, 'Buy milk');
    const bug = await createTask(token, 'Fix the login bug');
    await createTask(token, 'Write docs');

    const byText = await request(app.getHttpServer())
      .get('/tasks')
      .query({ q: 'bug' })
      .set('Authorization', `Bearer ${token}`);
    expect(byText.body.items.map((t: { title: string }) => t.title)).toEqual([
      'Fix the login bug',
    ]);

    await request(app.getHttpServer())
      .patch(`/tasks/${bug.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ done: true });

    const byDone = await request(app.getHttpServer())
      .get('/tasks')
      .query({ done: 'true' })
      .set('Authorization', `Bearer ${token}`);
    expect(byDone.body.items).toHaveLength(1);
    expect(byDone.body.items[0].title).toBe('Fix the login bug');
  });

  it('updates and deletes a task it owns', async () => {
    const token = await registerOrgWithAccessToken();
    const created = await createTask(token, 'Original title');

    const updated = await request(app.getHttpServer())
      .patch(`/tasks/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Edited title', done: true });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe('Edited title');
    expect(updated.body.done).toBe(true);

    const deleted = await request(app.getHttpServer())
      .delete(`/tasks/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleted.status).toBe(204);

    const listAfter = await request(app.getHttpServer())
      .get('/tasks')
      .set('Authorization', `Bearer ${token}`);
    expect(listAfter.body.items).toHaveLength(0);
  });

  it('returns 404 (not 403) for an id that no longer exists', async () => {
    const token = await registerOrgWithAccessToken();
    const created = await createTask(token, 'Temp');
    await request(app.getHttpServer())
      .delete(`/tasks/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);

    const patchGone = await request(app.getHttpServer())
      .patch(`/tasks/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ done: true });
    expect(patchGone.status).toBe(404);

    const deleteGone = await request(app.getHttpServer())
      .delete(`/tasks/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteGone.status).toBe(404);
  });

  describe('cross-tenant task access', () => {
    it('returns 404 (never 403) when org B guesses org A task id for PATCH', async () => {
      const tokenA = await registerOrgWithAccessToken();
      const tokenB = await registerOrgWithAccessToken();
      const taskA = await createTask(tokenA, 'Org A secret task');

      const res = await request(app.getHttpServer())
        .patch(`/tasks/${taskA.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ done: true });
      expect(res.status).toBe(404);

      // Confirm it's untouched, i.e. RLS actually blocked the write
      // rather than the update silently no-op'ing on the right row.
      const stillThere = await admin.task.findUnique({ where: { id: taskA.body.id } });
      expect(stillThere?.done).toBe(false);
    });

    it('returns 404 (never 403) when org B guesses org A task id for DELETE', async () => {
      const tokenA = await registerOrgWithAccessToken();
      const tokenB = await registerOrgWithAccessToken();
      const taskA = await createTask(tokenA, 'Org A secret task 2');

      const res = await request(app.getHttpServer())
        .delete(`/tasks/${taskA.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);

      const stillThere = await admin.task.findUnique({ where: { id: taskA.body.id } });
      expect(stillThere).not.toBeNull();
    });
  });
});
