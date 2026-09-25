# Arquitectura — TenantHub

> Estado: Sprint 0 a 4 implementados (modelo multi-tenant con RLS +
> auth/onboarding completo + `tasks` como feature real + roles/permisos:
> `RolesGuard` reutilizable, gestión de miembros con protección del
> último admin). Este documento describe lo que existe hoy y cómo encaja
> con lo que falta — ver `roadmap.md` para el detalle de los sprints
> pendientes.

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
   vivo: no tiene ningún `where: { orgId }` en ninguna query, ni siquiera
   en `update`/`delete` por id (Sprint 3). Ahí RLS hace que un id de otra
   organización simplemente no matchee ninguna fila; Prisma lo reporta
   como `P2025` (registro no encontrado), que el service traduce a `404`.
   Es indistinguible, a propósito, de un id que nunca existió — devolver
   `403` en cambio confirmaría que la fila existe, solo que no es tuya,
   filtrando información que RLS ya se encargó de ocultar.

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

### Sprint 2 amplía la misma excepción, no la abre más

Registro, invitaciones y refresh tokens tienen el mismo problema de fondo
que login: todos necesitan escribir o leer algo *antes* de que exista un
`app.current_org` para la request. En vez de inventar un mecanismo nuevo,
Sprint 2 agrega más funciones al mismo patrón angosto
(`backend/prisma/migrations/20260921141500_sprint2_auth_functions/` y
`.../20260921143000_invitation_lookup_function/`):

| Función | Para qué | Qué puede tocar |
|---|---|---|
| `auth_register(orgName, orgSlug, email, passwordHash)` | Crea org + user + membership admin atómicamente | Solo lo que la propia llamada crea |
| `auth_invitation_lookup(tokenHash)` | Lee una invitación por su hash exacto | Una fila, la que matchea el hash |
| `auth_accept_invitation(tokenHash, userId)` | Crea la membership al aceptar | Una invitación + una membership, ambas atadas al hash/userId recibidos |
| `auth_issue_refresh_token(...)` / `auth_consume_refresh_token(...)` / `auth_revoke_refresh_token(...)` | Ciclo de vida del refresh token | Una fila de `refresh_tokens`, identificada por su hash |

Cada una sigue la misma regla: `SECURITY DEFINER`, `REVOKE ALL FROM
PUBLIC` + `GRANT EXECUTE TO tenanthub_app`, y el alcance de lo que puede
leer/escribir está atado a los parámetros exactos que recibe — nunca a un
listado abierto. Ver ADR 0005 para el diseño de refresh tokens en
particular.

**Bug real encontrado y corregido en este sprint** (vale la pena dejarlo
documentado): `auth_accept_invitation` originalmente fallaba con
`column reference "org_id" is ambiguous` porque sus parámetros de salida
(`RETURNS TABLE(org_id uuid, role ...)`) colisionaban con las columnas
`org_id`/`role` referenciadas en `ON CONFLICT (org_id, user_id)`. Se
descubrió recién al probar el flujo completo de aceptar-invitación por
HTTP, no en la prueba manual por SQL de `auth_register` (que no tiene
`ON CONFLICT` y por eso no lo disparaba). La lección — y por qué
`docs/roadmap.md` insiste en probar cada flujo de punta a punta, no solo
sus piezas por separado — quedó en el comentario de la migración de fix
(`20260921144500_fix_accept_invitation_ambiguity`).

## Sesiones: access token corto + refresh token rotado

Desde Sprint 2, el JWT de acceso expira en 15 minutos
(`JWT_EXPIRES_IN`). Lo que sostiene la sesión es un **refresh token
opaco** (no un JWT — una cadena aleatoria sin payload), cuyo hash SHA-256
se guarda en `refresh_tokens` y se **rota en cada uso**: `POST
/auth/refresh` invalida el token presentado y devuelve uno nuevo; usar el
viejo de nuevo devuelve 401. `POST /auth/logout` lo revoca explícitamente.
Ver ADR 0005 para el razonamiento completo.

## Onboarding: registro e invitaciones

- `POST /auth/register`: alguien nuevo crea su organización y queda como
  `admin` — no hay paso previo de "crear cuenta" y luego "crear
  organización", es un solo paso atómico (`auth_register()`).
- `GET /auth/orgs?email=...`: dado un email, devuelve las organizaciones a
  las que pertenece (`auth_list_orgs_for_email`, ya existía desde Sprint 1
  sin endpoint) — así el login puede ofrecer un selector en vez de pedir
  el slug de memoria.
- `POST /organizations/invitations` (solo `admin` — chequeo manual en
  `InvitationsService`, ver nota sobre Sprint 4 en `roadmap.md`): genera
  un token de invitación, lo loguea al server (no hay SMTP configurado;
  ver el comentario en el código como punto de extensión documentado) y lo
  devuelve en la respuesta para poder probarlo/demostrarlo sin un
  proveedor de email real.
- `POST /auth/invitations/:token/accept`: crea la membership; si el email
  invitado no tiene cuenta todavía, pide password y la crea en el mismo
  paso. Responde con un par de tokens — quedás logueado al aceptar.

## Roles y permisos (Sprint 4)

`RolesGuard` + `@Roles(...)` (`backend/src/common/roles/`) es la versión
reutilizable de lo que `InvitationsService` hacía a mano en Sprint 2. Se
aplica por ruta con `@UseGuards(RolesGuard)`, y como corre **después** del
`TenantGuard` global (que ya dejó `request.tenant` seteado), solo necesita
comparar `request.tenant.role` contra los roles requeridos — no resuelve
tenant ni autentica nada por sí mismo:

```ts
@Roles('admin')
@UseGuards(RolesGuard)
@Post()
create(@Body() dto: CreateInvitationDto, @CurrentTenant() tenant: TenantClaims) { ... }
```

`GET /memberships` (cualquier rol) y `PATCH /memberships/:id` (solo
`admin`) viven en `MembershipsService`. El invariante "una organización no
puede quedarse sin admins" se resuelve así:

1. `SELECT id FROM memberships WHERE org_id = ... AND role = 'admin' FOR UPDATE`
   dentro de la misma transacción tenant-scoped — bloquea las filas admin
   de este org para que un segundo request concurrente sobre el mismo org
   tenga que esperar a que el primero termine.
2. Si la membership a cambiar es admin y el nuevo rol es member, cuenta
   cuántos **otros** admins quedan; si es cero, `409 Conflict`.

Sin el `FOR UPDATE`, dos requests simultáneos degradando a dos admins
distintos del mismo org podrían leer "hay otro admin" cada uno antes de
que el otro confirme, y dejar el org en cero admins — el mismo tipo de
condición de carrera que un `SELECT` sin bloqueo siempre tiene bajo
concurrencia. Serializar por org (no por fila individual) es lo que cierra
esa ventana.

**Un id de otra organización en `PATCH /memberships/:id` da 404, no
403** — mismo razonamiento que `tasks` en Sprint 3: RLS hace la fila
invisible, así que la API no puede confirmar que existe.

**Los cambios de rol no son instantáneos**: el rol vive en el JWT, no se
consulta en cada request. Alguien recién promovido sigue actuando con su
rol viejo hasta su próximo `POST /auth/refresh` (que sí relee el rol
actual desde `memberships`, ver `auth_consume_refresh_token` en Sprint 2)
o su próximo login. Es un trade-off consciente: consultar `memberships` en
cada request para evitar esta latencia anularía el punto de tener un JWT
stateless.

## Frontend (Angular)

`frontend/src/app/core/auth/`:

- `auth.service.ts`: login, register, listOrgs, acceptInvitation, refresh,
  logout. Guarda los tokens en `localStorage` (ver limitación conocida en
  `docs/threat-model.md`) y expone `isAuthenticated`/`claims` como
  signals, decodificando el JWT client-side solo para mostrar
  org/rol en la UI — **nunca** como fuente de verdad de autorización, eso
  siempre lo decide el backend.
- `auth.guard.ts`: `CanActivateFn` que redirige a `/login` si no hay
  access token.
- `auth.interceptor.ts`: agrega `Authorization: Bearer` a cada request al
  backend; ante un 401 (fuera de los propios endpoints de `/auth/`),
  intenta un refresh una sola vez y reintenta la request original —
  varias requests fallando a la vez comparten el mismo refresh en vuelo
  en vez de disparar N refreshes.
- `has-role.directive.ts` (Sprint 4): `*appHasRole="'admin'"` — versión
  Angular del mismo control de acceso que `RolesGuard` hace en el backend,
  pero solo para UX (ocultar un botón que igual fallaría en el servidor
  si se apretara). Soporta `; else plantilla` para mostrar una alternativa
  en vez de nada (ej. un badge de solo lectura en `/members`).

Rutas: `/login`, `/register`, `/accept-invitation/:token` (públicas),
`/dashboard`, `/tasks` y `/members` (protegidas por `authGuard`). El
dashboard quedó con la info de la organización, el formulario de
invitación (detrás de `*appHasRole="'admin'"`) y links a `/tasks` y
`/members`; `tasks` (Sprint 3) es su propia feature con listado paginado,
filtros por texto/estado (debounced) y edición inline; `members` (Sprint
4, `frontend/src/app/features/members/`) lista los miembros de la
organización con un `<select>` de rol por fila si sos admin, o un badge
de solo lectura si no. Todas reutilizan el mismo
`authGuard`/`authInterceptor` de Sprint 2 sin tocarlos.

## Modelo de datos

```
organizations (id, name, slug, plan, ...)
users (id, email, password_hash, ...)          -- global, no tenant-scoped
memberships (org_id, user_id, role)             -- une user ↔ organization
invitations (org_id, email, role, token_hash, expires_at, accepted_at)  -- Sprint 2
refresh_tokens (user_id, org_id, token_hash, expires_at, revoked_at)     -- Sprint 2
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
│   │       ├── 20260914211754_init/                          -- tablas Sprint 1
│   │       ├── 20260914212000_rls_policies/                  -- RLS + rol tenanthub_app
│   │       ├── 20260914213000_auth_lookup_function/          -- login (Sprint 1)
│   │       ├── 20260921140703_invitations_and_refresh_tokens/ -- tablas Sprint 2
│   │       ├── 20260921141500_sprint2_auth_functions/         -- register, accept-invite, refresh
│   │       ├── 20260921143000_invitation_lookup_function/
│   │       └── 20260921144500_fix_accept_invitation_ambiguity/
│   ├── src/
│   │   ├── common/
│   │   │   ├── prisma/          -- PrismaService (conecta como tenanthub_app)
│   │   │   ├── tenant/          -- Guard, Interceptor, AsyncLocalStorage, decorators
│   │   │   └── roles/            -- RolesGuard + @Roles() (Sprint 4)
│   │   ├── auth/                -- register, login, orgs, refresh, logout, accept-invitation
│   │   ├── organizations/       -- invitaciones (crear, listar) + memberships (listar, cambiar rol)
│   │   ├── tasks/                -- CRUD + paginación/filtros, cero filtros manuales por org
│   │   └── health/
│   └── test/
│       ├── rls/                  -- tests negativos de RLS contra Postgres real
│       ├── auth/                  -- tests e2e de los flujos de auth/onboarding sobre HTTP
│       ├── tasks/                 -- tests e2e de paginación/filtros/update/delete + 404 cruzado
│       └── memberships/            -- tests e2e de RolesGuard, cambio de rol, último-admin
├── frontend/                # Angular: login, registro, aceptar invitación, dashboard, tasks, members
│   ├── e2e/                  -- suite Playwright (crear→ver→editar→completar→eliminar, filtros, paginación)
│   ├── playwright.config.ts
│   └── src/app/
│       ├── core/auth/            -- AuthService, guard, interceptor (JWT + refresh), HasRoleDirective
│       ├── core/tasks/            -- TasksService
│       ├── core/organizations/    -- InvitationsService, MembershipsService
│       └── features/              -- login, register, accept-invitation, dashboard, tasks, members
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
npx prisma migrate deploy   # crea tablas, políticas RLS, funciones auth_* y el rol tenanthub_app
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
# abrir http://localhost:4200/register y crear una organización nueva,
# o http://localhost:4200/login con alice@acme.test / password123 / acme
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
- `test/auth/auth.e2e-spec.ts` (backend, misma suite `test:e2e`): 11 tests
  sobre HTTP real contra la app NestJS completa — registro, slug
  duplicado, login con password incorrecta, listado de orgs, invitar +
  aceptar + re-aceptar (410), no-admin no puede invitar (403), rotación
  de refresh token, logout, y una regresión de aislamiento a nivel API
  (org A nunca ve tareas de org B a través del endpoint, no solo por SQL
  directo). Limpia sus propios datos de prueba en `afterAll`.
- `test/tasks/tasks.e2e-spec.ts` (backend, Sprint 3): paginación, filtros
  por `done`/`q`, update/delete de una tarea propia, 404 sobre un id ya
  borrado, y los dos casos que más importan — org B intentando
  `PATCH`/`DELETE` un id de org A siempre da 404 (nunca 403), verificado
  además confirmando con el rol owner que la fila de la otra organización
  quedó intacta.
- `test/memberships/memberships.e2e-spec.ts` (backend, Sprint 4): listar
  es público para cualquier rol, un `member` no puede cambiar roles
  (403 vía `RolesGuard`), promover a un member funciona y su nuevo rol se
  ve recién tras un refresh, el admin único no puede degradarse a sí
  mismo (409) pero sí una vez que hay dos admins, y un id de membership de
  otra organización da 404 (nunca 403).
- Frontend: `npm test` (Angular/Karma) para unit tests; el flujo de roles
  (invitar → aceptar → el member no ve la UI de admin → promoverlo →
  demostrar que sigue sin poder actuar como admin hasta refrescar su
  sesión → el admin original se degrada una vez que hay dos → el nuevo
  admin único no puede degradarse) se verificó con un script Playwright
  ad-hoc contra un browser real, igual que el de Sprint 2 — no es parte
  de la suite versionada porque el roadmap de Sprint 4 solo pedía tests
  de autorización a nivel de backend, no e2e de Angular.
  `frontend/e2e/tasks.spec.ts` (Playwright, Sprint 3) cubre
  crear→ver→editar→completar→eliminar, filtros por texto/estado, y
  paginación, contra un browser real. Requiere el backend corriendo por
  separado (`frontend/playwright.config.ts` solo levanta el dev server de
  Angular) — ver `frontend/README.md`.
- CI: `.github/workflows/backend-ci.yml` (unit + RLS + tasks del backend),
  `.github/workflows/frontend-ci.yml` (build + unit tests de Angular en
  Chrome headless), y `.github/workflows/e2e-ci.yml` (Sprint 3: levanta
  Postgres + backend + Angular dev server y corre la suite Playwright
  completa contra el stack real).

## Qué NO está implementado todavía

Ver `docs/roadmap.md` para el detalle sprint por sprint. En resumen, fuera
de alcance de esta fase:

- Remover a un miembro de la organización (hoy solo se puede cambiar su
  rol vía `PATCH /memberships/:id`; no hay `DELETE /memberships/:id` —
  no lo pidió Sprint 4 y no se adelantó).
- Envío real de invitaciones por email (hoy el token se loguea y se
  devuelve en la respuesta HTTP, sin proveedor SMTP).
- Detección de reuso de un refresh token ya consumido como señal de robo
  (hoy simplemente falla con 401 — ver ADR 0005).
- Feature flags por plan, botón de cambio de plan, escritura real en
  `audit_log` (Sprint 5).
- Deploy productivo (Sprint 6).
