🇧🇷 Versão em português: [README.md](README.md)

# tenanthub

Micro-SaaS multi-tenant donde el aislamiento entre organizaciones lo
garantiza Row-Level Security de PostgreSQL — no un `WHERE org_id = ...`
que el backend podría olvidar. Stack: **Angular** · **NestJS** ·
**PostgreSQL + Prisma** (sin Supabase — ver
[ADR 0001](docs/decisions/0001-postgres-managed-over-supabase.md)).

🎥 [Video demo](demo/tenanthub-demo.webm) (~43s, generado con Playwright
contra la app real): dos organizaciones aisladas, gating por plan, y
audit log en acción.

## Estado actual: Sprint 0 a 5, Sprint 6 preparado

Implementado y probado:

- Modelo de datos multi-tenant (`organizations`, `users`, `memberships`,
  `invitations`, `refresh_tokens`, `tasks`, `audit_log`) con RLS
  deny-by-default en cada tabla tenant-scoped.
- Rol de aplicación no-owner (`tenanthub_app`) que RLS realmente
  restringe — el backend nunca se conecta con un rol que bypasse RLS.
- 10 tests **negativos** de RLS contra Postgres real: intentan leer,
  actualizar, borrar e insertar datos de otro tenant (o borrar auditoría
  sin tener el privilegio), y verifican que todo eso falle.
- Onboarding completo: registro (crea org + admin en un paso), login con
  selector de organización, invitar miembros, aceptar invitación, sesión
  sostenida con refresh tokens rotados (access token de 15 min).
- `tasks` como feature real: paginación, filtros por texto/estado,
  edición inline, marcar completada, borrar — con su propia ruta
  `/tasks` en Angular. Un id de otra organización siempre da 404, nunca
  403, para no filtrar que la fila existe.
- Roles y permisos: `RolesGuard`/`@Roles()` reutilizable en el backend,
  gestión de miembros (`/members`) con cambio de rol protegido — una
  organización nunca puede quedarse sin ningún admin, ni siquiera bajo
  dos requests concurrentes.
- Planes y auditoría: `PlanGuard`/`@RequiresPlan('pro')` gatea el export
  de CSV de tareas; un admin puede cambiar el plan de su org (simulando
  un webhook de billing); las cinco acciones sensibles (login, cambio de
  plan, invitación, cambio de rol, borrado de tarea) quedan registradas
  en `/audit-log`, visible solo para admins.
- 38 tests e2e de backend sobre HTTP real y SQL directo, más 1 unit test
  — 39 en total, la mayoría verificando que un ataque falla, no solo que
  el camino feliz funciona. Más una suite Playwright versionada
  (`frontend/e2e/`) contra un browser real.
- CI (backend, frontend y un job e2e full-stack) que levanta Postgres,
  aplica migraciones y corre toda la suite en cada push/PR — con un job
  `deploy` gateado por esos mismos tests (Sprint 6, ver más abajo).

Preparado pero **no ejecutado** (este entorno de desarrollo no tiene
credenciales de ningún proveedor de hosting): `Dockerfile` del backend,
blueprint de Render (`render.yaml`) + config de Vercel
(`frontend/vercel.json`), y los jobs de CI que dispararían el deploy real
una vez configurados los secrets. Guía completa, paso a paso, en
**[docs/deploy.md](docs/deploy.md)**.

Para el detalle completo, sprint por sprint (lo que falta y por qué), ver
**[docs/roadmap.md](docs/roadmap.md)**.

## Documentación

| Archivo | Contenido |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Cómo funciona el aislamiento de principio a fin, estructura del repo, cómo correr todo |
| [docs/roadmap.md](docs/roadmap.md) | Qué está hecho y qué falta, sprint por sprint |
| [docs/threat-model.md](docs/threat-model.md) | Qué ataques se probaron, qué mitiga cada cosa, riesgo residual documentado |
| [docs/deploy.md](docs/deploy.md) | Deploy real: Render (backend + Postgres) + Vercel (frontend), paso a paso |
| [docs/decisions/](docs/decisions/) | ADRs: por qué Postgres normal en vez de Supabase, por qué Prisma, diseño de roles de RLS, auth propia, refresh tokens, plan/audit log |
| [demo/](demo/) | Video demo + qué muestra cada paso |

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

Probar el aislamiento (vía API):

```bash
curl -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"alice@acme.test","password":"password123","orgSlug":"acme"}'
# copiar accessToken del response
curl localhost:3000/tasks -H "Authorization: Bearer <accessToken>"
```

O directamente en el navegador: `http://localhost:4200/register` para
crear una organización nueva, o `http://localhost:4200/login` con
`alice@acme.test` / `password123` / org `acme` (usuarios del seed).

## Tests

```bash
cd backend
npm test         # unit tests
npm run test:e2e # RLS negativos + flujos de auth/onboarding + tasks, sobre HTTP real

cd ../frontend
npm test         # unit tests (Karma)
npm run e2e      # Playwright — requiere el backend corriendo (ver frontend/README.md)
```
