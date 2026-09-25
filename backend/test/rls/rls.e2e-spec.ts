import 'dotenv/config';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

/**
 * These tests deliberately bypass NestJS entirely and talk to Postgres
 * directly with the `pg` driver, using the actual `tenanthub_app` role.
 * The point of Sprint 1 isn't "does the API return the right JSON" — it's
 * "can the database itself be tricked into leaking another tenant's rows,
 * no matter what queries a buggy or malicious application layer sends it".
 *
 * Every test below is a negative test: it tries the attack and asserts
 * that it fails, rather than only checking the happy path.
 */

let admin: Client; // connects as the schema owner — used only to seed/clean fixtures
let orgA: string;
let orgB: string;
let taskA: string;
let taskB: string;
let auditA: string;
let auditB: string;

async function appClientAs(orgId: string | null): Promise<Client> {
  const client = new Client({ connectionString: process.env.APP_DATABASE_URL });
  await client.connect();
  if (orgId) {
    await client.query('SELECT set_config($1, $2, false)', [
      'app.current_org',
      orgId,
    ]);
  }
  return client;
}

beforeAll(async () => {
  admin = new Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
});

afterAll(async () => {
  await admin.end();
});

beforeEach(async () => {
  orgA = randomUUID();
  orgB = randomUUID();
  taskA = randomUUID();
  taskB = randomUUID();
  auditA = randomUUID();
  auditB = randomUUID();

  await admin.query(
    `INSERT INTO organizations (id, name, slug, updated_at) VALUES
       ($1, 'RLS Test Org A', $3, now()),
       ($2, 'RLS Test Org B', $4, now())`,
    [orgA, orgB, `rls-test-a-${orgA}`, `rls-test-b-${orgB}`],
  );

  await admin.query(
    `INSERT INTO tasks (id, org_id, title, created_by, updated_at) VALUES
       ($1, $3, 'Task belonging to Org A', $3, now()),
       ($2, $4, 'Task belonging to Org B', $4, now())`,
    [taskA, taskB, orgA, orgB],
  );

  await admin.query(
    `INSERT INTO audit_log (id, org_id, action, entity) VALUES
       ($1, $3, 'test.seeded', 'test'),
       ($2, $4, 'test.seeded', 'test')`,
    [auditA, auditB, orgA, orgB],
  );
});

afterEach(async () => {
  await admin.query('DELETE FROM audit_log WHERE org_id IN ($1, $2)', [orgA, orgB]);
  await admin.query('DELETE FROM tasks WHERE org_id IN ($1, $2)', [orgA, orgB]);
  await admin.query('DELETE FROM organizations WHERE id IN ($1, $2)', [
    orgA,
    orgB,
  ]);
});

describe('Row-Level Security — tenant isolation', () => {
  it('a session scoped to org A cannot read org B tasks', async () => {
    const client = await appClientAs(orgA);
    try {
      const res = await client.query('SELECT id FROM tasks');
      const ids = res.rows.map((r) => r.id);
      expect(ids).toContain(taskA);
      expect(ids).not.toContain(taskB);
    } finally {
      await client.end();
    }
  });

  it('a session scoped to org B cannot read org A tasks', async () => {
    const client = await appClientAs(orgB);
    try {
      const res = await client.query('SELECT id FROM tasks');
      const ids = res.rows.map((r) => r.id);
      expect(ids).toContain(taskB);
      expect(ids).not.toContain(taskA);
    } finally {
      await client.end();
    }
  });

  it('a session with no tenant context set sees nothing at all (deny by default)', async () => {
    const client = await appClientAs(null);
    try {
      const res = await client.query('SELECT id FROM tasks');
      expect(res.rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });

  it('a session scoped to org B cannot UPDATE an org A row by guessing its id', async () => {
    const client = await appClientAs(orgB);
    try {
      const res = await client.query(
        "UPDATE tasks SET title = 'hacked' WHERE id = $1",
        [taskA],
      );
      expect(res.rowCount).toBe(0);

      const check = await admin.query('SELECT title FROM tasks WHERE id = $1', [
        taskA,
      ]);
      expect(check.rows[0].title).toBe('Task belonging to Org A');
    } finally {
      await client.end();
    }
  });

  it('a session scoped to org B cannot DELETE an org A row by guessing its id', async () => {
    const client = await appClientAs(orgB);
    try {
      const res = await client.query('DELETE FROM tasks WHERE id = $1', [taskA]);
      expect(res.rowCount).toBe(0);

      const check = await admin.query('SELECT 1 FROM tasks WHERE id = $1', [
        taskA,
      ]);
      expect(check.rows).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it('a session scoped to org B cannot INSERT a task claiming to belong to org A (WITH CHECK)', async () => {
    const client = await appClientAs(orgB);
    try {
      await expect(
        client.query(
          `INSERT INTO tasks (id, org_id, title, created_by, updated_at)
           VALUES ($1, $2, 'forged task', $2, now())`,
          [randomUUID(), orgA],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.end();
    }
  });

  it('a session scoped to org A cannot see org B in the organizations table either', async () => {
    const client = await appClientAs(orgA);
    try {
      const res = await client.query('SELECT id FROM organizations');
      const ids = res.rows.map((r) => r.id);
      expect(ids).toEqual([orgA]);
    } finally {
      await client.end();
    }
  });
});

describe('Row-Level Security — audit_log (Sprint 5)', () => {
  it('a session scoped to org A cannot read org B audit entries', async () => {
    const client = await appClientAs(orgA);
    try {
      const res = await client.query('SELECT id FROM audit_log');
      const ids = res.rows.map((r) => r.id);
      expect(ids).toContain(auditA);
      expect(ids).not.toContain(auditB);
    } finally {
      await client.end();
    }
  });

  it('a session scoped to org B cannot INSERT an audit row claiming to belong to org A (WITH CHECK)', async () => {
    const client = await appClientAs(orgB);
    try {
      await expect(
        client.query(
          `INSERT INTO audit_log (id, org_id, action, entity) VALUES ($1, $2, 'forged.action', 'test')`,
          [randomUUID(), orgA],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.end();
    }
  });

  it("tenanthub_app cannot DELETE audit_log rows, even its own org's", async () => {
    // Separate from RLS: DELETE was revoked from tenanthub_app entirely
    // (see the Sprint 1 RLS migration) so the audit trail can't be erased
    // even by a fully compromised app connection scoped to the right org.
    const client = await appClientAs(orgA);
    try {
      await expect(
        client.query('DELETE FROM audit_log WHERE id = $1', [auditA]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.end();
    }
  });
});
