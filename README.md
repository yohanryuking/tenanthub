# tenanthub

Micro-SaaS multi-tenant donde el aislamiento entre organizaciones lo
garantiza Row-Level Security de PostgreSQL — no un `WHERE org_id = ...`
que el backend podría olvidar. Stack: **Angular** · **NestJS** ·
**PostgreSQL + Prisma** (sin Supabase — ver
[ADR 0001](docs/decisions/0001-postgres-managed-over-supabase.md)).

## Estado actual: Fase 1 (Sprint 0 + Sprint 1)

Implementado y probado:

- Modelo de datos multi-tenant (`organizations`, `users`, `memberships`,
  `tasks`, `audit_log`) con RLS deny-by-default en cada tabla
  tenant-scoped.
- Rol de aplicación no-owner (`tenanthub_app`) que RLS realmente
  restringe — el backend nunca se conecta con un rol que bypasse RLS.
- 7 tests **negativos** de RLS contra Postgres real: intentan leer,
  actualizar, borrar e insertar datos de otro tenant, y verifican que
  todo eso falle.
- Un login mínimo (JWT scoped a una organización) + un CRUD de ejemplo
  (`tasks`) que demuestran el aislamiento también a nivel HTTP, de punta
  a punta.
- CI que levanta Postgres, aplica migraciones y corre toda la suite en
  cada push/PR.

Para el detalle completo, sprint por sprint (lo que falta y por qué), ver
**[docs/roadmap.md](docs/roadmap.md)**.

## Documentación

| Archivo | Contenido |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Cómo funciona el aislamiento de principio a fin, estructura del repo, cómo correr todo |
| [docs/roadmap.md](docs/roadmap.md) | Qué está hecho y qué falta, sprint por sprint |
| [docs/threat-model.md](docs/threat-model.md) | Qué ataques se probaron, qué mitiga cada cosa, riesgo residual documentado |
| [docs/decisions/](docs/decisions/) | ADRs: por qué Postgres normal en vez de Supabase, por qué Prisma, por qué el diseño de roles de RLS, por qué auth propia |

## Quickstart

```bash
docker compose up -d postgres

cd backend
cp .env.example .env
npm install
npx prisma migrate deploy
npx prisma db seed
npm run start:dev
```

```bash
cd frontend
npm install
npm start
```

Probar el aislamiento:

```bash
curl -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"alice@acme.test","password":"password123","orgSlug":"acme"}'
# copiar accessToken del response
curl localhost:3000/tasks -H "Authorization: Bearer <accessToken>"
```

## Tests

```bash
cd backend
npm test        # unit tests
npm run test:e2e # tests negativos de RLS contra Postgres real
```
