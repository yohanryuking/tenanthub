# Arquitectura — TenantHub

> Estado: Fase 1 (Sprint 0 + Sprint 1) implementada. Este documento describe
> lo que existe hoy y cómo encaja con lo que falta — ver `roadmap.md` para
> el detalle de los sprints pendientes.

## Resumen

TenantHub es un micro-SaaS multi-tenant cuyo diferenciador es que el
aislamiento entre organizaciones no depende de que el backend recuerde
filtrar por `org_id` en cada query: lo garantiza PostgreSQL vía Row-Level
Security (RLS). El backend (NestJS) se limita a resolver **qué** tenant
está haciendo la request (a partir de un JWT firmado) y a abrir una
transacción de base de datos que declara ese tenant; la base de datos hace
el resto.

### Cambio respecto a la propuesta original

La propuesta original usaba **Supabase** (Postgres administrado + Auth +
RLS). Esta implementación usa **PostgreSQL "normal"** (auto-hosteado o en
cualquier proveedor administrado — RDS, Cloud SQL, Neon, etc.) con:

- **Prisma** como capa de acceso a datos y migraciones (en vez del cliente
  JS de Supabase).
- **Autenticación propia** en NestJS (`@nestjs/jwt` + `passport-jwt` +
  `bcrypt`), en vez de Supabase Auth — porque al quitar Supabase, Auth deja
  de venir gratis y hay que resolverlo explícitamente.
- El **mecanismo de RLS es idéntico en espíritu** al de Supabase: políticas
  `USING/WITH CHECK` sobre una variable de sesión (`app.current_org`), que
  es exactamente el patrón que usa Supabase internamente con
  `auth.jwt()`/`current_setting`. Ver ADR
  [0001](decisions/0001-postgres-managed-over-supabase.md).

## Diagrama de componentes

```
┌────────────┐        ┌──────────────────────────────────────┐        ┌─────────────────────────┐
│  Cliente   │  HTTP  │  Backend (NestJS)                     │  SQL   │  PostgreSQL              │
│  (Angular) │───────▶│                                        │───────▶│                          │
│            │        │  TenantGuard      → verifica JWT       │        │  RLS por org_id en cada  │
│            │        │  TenantInterceptor→ abre transacción    │        │  tabla tenant-scoped     │
│            │        │                    y hace SET LOCAL     │        │                          │
│            │        │  AuthModule       → login (bcrypt+JWT)  │        │  Rol tenanthub_app       │
│            │        │  TasksModule      → CRUD de ejemplo     │        │  (no-owner, RLS aplica)  │
└────────────┘        └──────────────────────────────────────┘        └─────────────────────────┘
```

## El mecanismo de aislamiento, paso a paso

1. **Login** (`POST /auth/login`, público): el cliente manda
   `email + password + orgSlug` (como elegir un workspace de Slack). El
   backend resuelve esa combinación con una función SQL
   `auth_login_lookup(email, org_slug)` — ver más abajo por qué esto no es
   una excepción a RLS sino un agujero deliberadamente angosto — y si la
   contraseña matchea, firma un JWT con `{ sub: userId, orgId, role }`.
   **El JWT queda atado a una organización específica** en el momento de
   emitirlo.

2. **Cada request autenticada** lleva ese JWT en `Authorization: Bearer`.
   `TenantGuard` (`src/common/tenant/tenant.guard.ts`) lo verifica
   criptográficamente y escribe `request.tenant = { userId, orgId, role }`.
   El `orgId` **nunca** se lee del body, query string o headers propuestos
   por el cliente — solo del payload firmado.

3. `TenantInterceptor` (`src/common/tenant/tenant.interceptor.ts`) abre una
   transacción de Prisma y ejecuta
   `SELECT set_config('app.current_org', $orgId, true)` — el tercer
   argumento `true` la hace *transaction-local* (equivalente a
   `SET LOCAL`). Guarda ese cliente transaccional en un
   `AsyncLocalStorage` (`TenantContextService`), de forma que sea
   accesible desde cualquier service de esa request sin pasarlo
   explícitamente, y sin que se filtre entre requests concurrentes de
   distintos tenants (cada una tiene su propio `AsyncLocalStorage` store y
   su propia transacción/conexión).

4. Cualquier query que un service haga a través de
   `tenantContext.getClient()` corre dentro de esa transacción. Las
   políticas RLS de Postgres —no el código de NestJS— son las que deciden
   qué filas son visibles o modificables. `TasksService` es el ejemplo
   vivo: no tiene ningún `where: { orgId }` en ninguna query.

5. Si el interceptor/guard nunca corrieran (p. ej. un desarrollador nuevo
   olvida aplicarlos a un endpoint nuevo), `getClient()` lanza un error en
   vez de caer silenciosamente a una conexión sin RLS — no hay fallback
   inseguro.

## Roles de base de datos

Este es el detalle que hace que RLS sea una garantía real y no solo una
buena práctica documentada:

| Rol | Uso | Bypassa RLS |
|---|---|---|
| `postgres` (owner, `DATABASE_URL`) | Solo `prisma migrate` / seeds locales | Sí (todo owner/superuser bypassa RLS) |
| `tenanthub_app` (`APP_DATABASE_URL`) | El backend, en runtime, siempre | No |

**La aplicación nunca se conecta como owner.** Esto es intencional y está
verificado: `PrismaService` lanza un error de arranque si
`APP_DATABASE_URL` no está seteada, precisamente para que nadie pueda
"simplificar" el `.env` apuntando el runtime al rol que hace bypass de RLS.

## La excepción angosta: login antes de tener tenant

Para autenticar a alguien todavía no sabemos su `org_id` — es lo que la
query está tratando de averiguar. No se le puede pedir a esa query que
respete `app.current_org` porque ese valor todavía no existe. La solución
**no** es darle a `tenanthub_app` un bypass general de RLS (eso invalidaría
todo el diseño). En cambio, la migración
`20260914213000_auth_lookup_function` crea dos funciones SQL
`SECURITY DEFINER` (`auth_login_lookup`, `auth_list_orgs_for_email`):
corren con los privilegios del owner (por eso pueden leer entre tenants),
pero **solo devuelven la fila que coincide exactamente con los parámetros
recibidos** — nunca un listado general. Es la única fisura deliberada en
el modelo, está en un solo archivo, y está documentada ahí mismo.

## Modelo de datos (Fase 1)

```
organizations (id, name, slug, plan, ...)
users (id, email, password_hash, ...)          -- global, no tenant-scoped
memberships (org_id, user_id, role)             -- une user ↔ organization
tasks (id, org_id, title, ..., created_by)      -- dominio de ejemplo (Sprint 3 lo expande)
audit_log (id, org_id, actor_id, action, ...)    -- tabla y RLS listas; Sprint 5 escribe en ella
```

Todas menos `users` tienen `ENABLE ROW LEVEL SECURITY` + policy
`USING/WITH CHECK (org_id = current_setting('app.current_org', true)::uuid)`.
`users` es intencionalmente global: la relación N:M usuario↔organización
vive en `memberships`, así que un mismo usuario puede pertenecer a varias
organizaciones (patrón Slack/Notion) sin duplicar filas de usuario.

`plans` no es una tabla separada todavía — es una columna `plan` en
`organizations` (`free`/`pro`). El *gating* por plan (bloquear una acción
si el plan no alcanza) es contenido de Sprint 5; la columna existe desde
ya para no requerir una migración destructiva más adelante.

## Estructura del repo

```
tenanthub/
├── backend/                # NestJS + Prisma + tests de RLS
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── seed.ts
│   │   └── migrations/
│   │       ├── 20260914211754_init/            -- tablas
│   │       ├── 20260914212000_rls_policies/    -- RLS + rol tenanthub_app
│   │       └── 20260914213000_auth_lookup_function/
│   ├── src/
│   │   ├── common/
│   │   │   ├── prisma/          -- PrismaService (conecta como tenanthub_app)
│   │   │   └── tenant/          -- Guard, Interceptor, AsyncLocalStorage, decorators
│   │   ├── auth/                -- login (bcrypt + JWT scoped a un org)
│   │   ├── tasks/                -- CRUD de ejemplo, cero filtros manuales por org
│   │   └── health/
│   └── test/rls/                 -- tests negativos de RLS contra Postgres real
├── frontend/                # Angular (shell mínimo — Sprint 3 construye el feature real)
├── docs/
│   ├── architecture.md      -- este archivo
│   ├── roadmap.md
│   ├── threat-model.md
│   └── decisions/           -- ADRs
└── docker-compose.yml        -- Postgres local para desarrollo
```

## Cómo correr todo localmente

```bash
# 1. Base de datos
docker compose up -d postgres

# 2. Backend
cd backend
cp .env.example .env
npm install
npx prisma migrate deploy   # crea tablas, políticas RLS y el rol tenanthub_app
npx prisma db seed           # 2 orgs, 2 usuarios, 1 task cada una
npm run start:dev

# 3. Probar aislamiento manualmente
curl -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"alice@acme.test","password":"password123","orgSlug":"acme"}'
# copiar el accessToken y:
curl localhost:3000/tasks -H "Authorization: Bearer <token>"

# 4. Frontend
cd ../frontend
npm install
npm start
```

## Testing

- `npm test` (backend): unit tests estándar de Jest.
- `npm run test:e2e` (backend): tests **negativos** de RLS
  (`test/rls/rls.e2e-spec.ts`) que se conectan directamente a Postgres con
  el rol `tenanthub_app` (sin pasar por NestJS) e intentan:
  - leer filas de otro tenant,
  - actualizar/borrar una fila de otro tenant adivinando su id,
  - insertar una fila falsificando el `org_id`,
  - leer sin haber seteado ningún tenant context (debe ver cero filas).

  Cada uno de estos debe **fallar** para que el test pase — es la prueba de
  que el modelo de amenazas de multi-tenancy está cubierto, no solo el
  camino feliz.
- CI (`.github/workflows/backend-ci.yml`) levanta un Postgres real como
  servicio, aplica las migraciones (que crean el rol `tenanthub_app` desde
  cero) y corre ambas suites.

## Qué NO está implementado todavía

Ver `docs/roadmap.md` para el detalle sprint por sprint. En resumen, fuera
de alcance de esta fase:

- Registro de usuarios / creación automática de organización, invitaciones
  por email (Sprint 2).
- Feature completo de Angular (routing protegido, reactive forms más allá
  del shell) (Sprint 3).
- Autorización fina admin/member en UI y backend más allá del campo `role`
  que ya viaja en el JWT (Sprint 4).
- Feature flags por plan, botón de cambio de plan, escritura real en
  `audit_log` (Sprint 5).
- Deploy productivo (Sprint 6).
