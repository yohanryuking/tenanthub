# tenanthub backend

NestJS + Prisma + PostgreSQL (RLS-enforced multi-tenancy). See
[`../docs/architecture.md`](../docs/architecture.md) for how the tenant
isolation actually works before changing anything in `src/common/tenant/`
or `prisma/migrations/`.

## Setup

```bash
cp .env.example .env
npm install
npx prisma migrate deploy   # creates tables, RLS policies, and the tenanthub_app role
npx prisma db seed           # 2 orgs, 2 users, 1 task each (see prisma/seed.ts for credentials)
npm run start:dev
```

## Tests

```bash
npm test        # unit tests
npm run test:e2e # negative RLS tests against a real Postgres instance
```

## Adding a new tenant-scoped table

1. Add the model to `prisma/schema.prisma` with an `orgId` column.
2. `npx prisma migrate dev --name add_x --create-only`, then edit the
   generated `migration.sql` to also add:
   ```sql
   ALTER TABLE x ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation_x ON x
     USING (org_id = current_setting('app.current_org', true)::uuid)
     WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);
   ```
   Grants to `tenanthub_app` are already blanket (`ALTER DEFAULT
   PRIVILEGES` in the RLS migration), so a new table doesn't need its own
   GRANT statement — only its own policy.
3. Add a negative test in `test/rls/` proving cross-org reads/writes fail.
4. Access it in services only through `TenantContextService.getClient()`,
   never through `PrismaService` directly — that's what keeps every query
   inside the request's RLS-scoped transaction.
