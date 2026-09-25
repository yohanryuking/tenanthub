# Roadmap — TenantHub

Este documento es la fuente de verdad de qué está hecho y qué falta.
Cualquier desarrollador que retome el proyecto debería poder leer esto y
saber exactamente por dónde seguir.

Convención: ✅ hecho · 🚧 parcialmente hecho · ⬜ no empezado.

---

## Sprint 0 — Setup ✅

- [x] Monorepo (`backend/`, `frontend/`, `docs/`).
- [x] `docker-compose.yml` con Postgres 16 para desarrollo local.
- [x] Backend NestJS con TypeScript estricto, ESLint, Jest.
- [x] Frontend Angular (shell con routing) — ver nota en Sprint 3.
- [x] CI (`.github/workflows/backend-ci.yml`): Postgres de servicio, migra,
      type-checks, corre unit + RLS tests en cada push/PR.

## Sprint 1 — Modelo de datos multi-tenant ✅

- [x] Esquema Prisma: `organizations`, `users`, `memberships`, `tasks`,
      `audit_log` (`backend/prisma/schema.prisma`).
- [x] RLS deny-by-default en las 4 tablas tenant-scoped
      (`backend/prisma/migrations/20260914212000_rls_policies/`).
- [x] Rol de aplicación no-owner (`tenanthub_app`) que RLS realmente
      restringe — la app nunca se conecta como el rol dueño de las tablas.
- [x] Tests negativos de RLS contra Postgres real
      (`backend/test/rls/rls.e2e-spec.ts`): lectura cruzada, update/delete
      adivinando IDs, insert falsificando `org_id`, sesión sin tenant
      seteado. Los 7 casos están escritos para **fallar el ataque**, no
      para pasar el camino feliz.

### Extra incluido en esta fase (no pedido explícitamente por el sprint, pero necesario para que el modelo fuera demostrable end-to-end)

Para poder probar el aislamiento también a nivel HTTP (no solo con SQL
directo), se adelantó una versión mínima de:

- `POST /auth/login` (email + password + orgSlug → JWT scoped a un org).
- `TenantGuard` + `TenantInterceptor` + `TenantContextService`
  (`backend/src/common/tenant/`): resuelven el tenant desde el JWT y abren
  la transacción con `SET LOCAL app.current_org` por request.
- `GET/POST /tasks`: CRUD de ejemplo que no filtra por `org_id` en ningún
  lado — depende 100% de RLS.

Esto **no reemplaza** el Sprint 2 (que sigue pendiente en su totalidad):
no hay registro de usuarios, no hay creación automática de organización al
registrarse, no hay invitaciones por email, no hay UI de login. Lo que
existe es el mínimo indispensable para que las políticas RLS tuvieran un
caller real que probar, y una base de código sobre la que Sprint 2 puede
construir directamente (el `AuthService` de hoy es un punto de partida,
no un feature terminado).

---

## Sprint 2 — Auth y onboarding ✅

Objetivo: pasar de "hay un login mínimo" a un flujo de onboarding real.

- [x] `POST /auth/register`: crea `Organization` + `User` + `Membership`
      (rol `admin`) atómicamente vía la función SQL `auth_register()`
      (`backend/prisma/migrations/20260921141500_sprint2_auth_functions/`)
      — "regístrate y te creamos tu workspace", como Slack/Notion/Linear.
- [x] `GET /auth/orgs?email=...` usando `auth_list_orgs_for_email` (ya
      existía desde Sprint 1, ahora tiene endpoint) para que el login
      ofrezca un selector de organización en vez de pedir el slug a mano.
- [x] Invitaciones: `POST /organizations/invitations` (solo `admin`,
      verificado a mano en `InvitationsService` — ver nota sobre Sprint 4
      más abajo), token de un solo uso con expiración
      (`INVITATION_TTL_DAYS`, default 7 días). Sin SMTP real: el token se
      loguea al server y se devuelve en la respuesta (documentado en el
      propio código como el punto de extensión — mismo patrón que "aquí
      conectaría Stripe" del Sprint 5).
- [x] `POST /auth/invitations/:token/accept`: crea `Membership` para un
      usuario existente o nuevo (pide password solo si el email no tiene
      cuenta todavía), auto-login al aceptar.
- [x] Refresh tokens: el access token (JWT) ahora expira en 15 minutos
      (`JWT_EXPIRES_IN`); un refresh token opaco, rotado en cada uso y
      revocable, sostiene la sesión (`REFRESH_TOKEN_TTL_DAYS`, default 30
      días). `POST /auth/refresh` y `POST /auth/logout`. Ver
      `docs/decisions/0005-refresh-token-rotation.md`.
- [x] Angular: `/login` (con selector de organización), `/register`,
      `/accept-invitation/:token`, `/dashboard` (guardado por
      `authGuard`), interceptor HTTP que agrega el JWT y reintenta una vez
      vía refresh ante un 401. Probado de punta a punta en un browser real
      (registro → tarea → invitar → logout → login → aceptar invitación
      como nuevo usuario en un contexto separado → acceso no autenticado
      redirige a `/login`).
- [x] Tests: 18 casos e2e sobre HTTP real (`backend/test/auth/`) — slug
      duplicado rechazado, login con password incorrecta, listado de orgs,
      invitación aceptada una sola vez (segunda vez → 410), no-admin no
      puede invitar (403), rotación de refresh token invalida el anterior,
      logout revoca, y una regresión a nivel API de que un token de la org
      A nunca devuelve tareas de la org B.

### Nota: `InvitationsService` NO usa un `RolesGuard` genérico todavía

El chequeo "solo admin puede invitar" está hecho a mano dentro del service
(`if (tenant.role !== 'admin') throw new ForbiddenException(...)`),
comentado explícitamente en el código como una versión mínima de lo que
Sprint 4 formaliza (`@Roles('admin')` + `RolesGuard` reutilizable). No se
adelantó Sprint 4 completo — solo lo estrictamente necesario para que
"invitar" tuviera la restricción de seguridad que el propio Sprint 2 pedía.

## Sprint 3 — Feature core del SaaS ✅

El dominio de ejemplo (`tasks`) ya tenía esquema + API + una UI mínima
(listado y creación en `/dashboard`, ver Sprint 2) desde antes de este
sprint; acá se volvió un feature real de producto, con su propia sección
de la app en vez de vivir dentro del dashboard genérico.

- [x] Backend: `PATCH /tasks/:id`, `DELETE /tasks/:id`
      (`backend/src/tasks/`), paginación (`page`/`pageSize`) y filtros
      (`done`, `q` por título) en `GET /tasks`. Un id que pertenece a otra
      organización devuelve **404, nunca 403** — RLS hace invisible la
      fila en vez de rechazar el acceso, así que la API no puede
      contradecir eso confirmando "existe pero no es tuya". Implementado
      dejando que el `P2025` de Prisma (update/delete singular que no
      matchea ninguna fila) se traduzca a `NotFoundException`, sin ningún
      chequeo manual de `orgId`.
- [x] Angular: `tasks` se movió del dashboard a su propia ruta `/tasks`
      (`frontend/src/app/features/tasks/`) con listado paginado (5 por
      página), filtro por texto y por estado (debounced), edición inline
      del título (click → input → blur/Enter guarda), marcar como
      completada, eliminar. `authGuard`/`authInterceptor` de Sprint 2 se
      reutilizaron sin cambios. El dashboard quedó con la info de la
      organización, el formulario de invitación, y un link a `/tasks`.
- [x] Tests e2e de Angular: se eligió **Playwright**
      (`frontend/e2e/tasks.spec.ts`, `frontend/playwright.config.ts`) —
      versionado en el repo esta vez, a diferencia del script ad-hoc de
      Sprint 2. Cubre exactamente el flujo pedido
      (crear→ver→editar→completar→eliminar) más filtros y paginación.
      Corre en CI (`.github/workflows/e2e-ci.yml`) contra un backend y
      Postgres reales, no mockeados.
- [x] Tests de backend: 6 casos nuevos e2e sobre HTTP real
      (`backend/test/tasks/tasks.e2e-spec.ts`) — paginación, filtros,
      update/delete propios, 404 en un id ya borrado, y los dos casos de
      seguridad más importantes: un id de otra organización da 404 tanto
      en PATCH como en DELETE, verificado además comprobando con el rol
      owner que la fila de la otra organización quedó intacta.

## Sprint 4 — Roles y permisos ✅

- [x] Guard de NestJS `RolesGuard` + decorator `@Roles('admin')`
      (`backend/src/common/roles/`) que lee `request.tenant.role` (ya
      viajaba en el JWT desde Sprint 1) para restringir endpoints. El
      chequeo manual de `InvitationsService.create()` (Sprint 2) se
      reemplazó por `@Roles('admin') @UseGuards(RolesGuard)` en el
      controller — el service quedó sin ninguna lógica de autorización.
- [x] Angular: directiva estructural `*appHasRole="'admin'"`
      (`frontend/src/app/core/auth/has-role.directive.ts`, con soporte
      para `; else plantilla`) para ocultar UI que el usuario no puede
      usar — el dashboard y `/members` la usan. Sigue siendo solo UX: el
      backend es la barrera real en los dos casos.
- [x] `GET /memberships` (cualquier miembro) y `PATCH /memberships/:id`
      (solo `admin`, vía `@Roles`) para cambiar el rol de otro miembro
      (`backend/src/organizations/memberships.*`). La regla de "una
      organización no puede quedarse sin ningún admin" se implementa con
      un `SELECT ... FOR UPDATE` sobre las membresías admin del org antes
      de recontar, para serializar cambios de rol concurrentes y evitar
      que dos demociones simultáneas dejen el org en cero admins.
- [x] Angular: `/members` (`frontend/src/app/features/members/`) lista
      los miembros de la organización; un admin ve un `<select>` de rol
      por fila (oculto para member vía `*appHasRole`), un member ve solo
      un badge de solo lectura.
- [x] Tests de autorización: 5 casos e2e nuevos
      (`backend/test/memberships/memberships.e2e-spec.ts`) — listar es
      público para cualquier rol, un `member` no puede cambiar roles
      (403), promover a un member funciona, el admin único no puede
      degradarse (409) pero sí una vez que hay dos, y un id de membership
      de otra organización da 404 (no 403), igual que con `tasks`.

### Nota: los cambios de rol tardan hasta el próximo refresh en verse reflejados

El JWT de acceso es una foto del rol al momento de emitirse. Cuando un
admin cambia el rol de otro miembro, ese miembro sigue actuando con su rol
viejo hasta que su token se renueve —`POST /auth/refresh` relee el rol
actual desde `memberships` en cada llamada (`auth_consume_refresh_token`,
Sprint 2), así que el cambio se ve en el próximo refresh o login, nunca
instantáneamente. Es un comportamiento esperado (documentado en
`docs/architecture.md` y `docs/threat-model.md`), no un bug — la
alternativa (consultar la base en cada request para leer el rol en vez de
confiar en el JWT) rompería el punto de tener JWT stateless para empezar.

## Sprint 5 — Planes, feature flags y audit log ✅

- [x] `PlanGuard` + decorator `@RequiresPlan('pro')`
      (`backend/src/common/plan/`): bloquea `GET /tasks/export.csv` si
      `organization.plan` no alcanza. Como el rol (Sprint 4), el plan viaja
      como claim en el JWT (`plan`), agregado a las cuatro funciones SQL
      que emiten tokens (`auth_login_lookup`, `auth_register`,
      `auth_accept_invitation`, `auth_consume_refresh_token`) — mismo
      trade-off ya documentado: un cambio de plan se ve recién en el
      próximo refresh/login de cada sesión, no instantáneamente.
- [x] `PATCH /organizations/plan` (solo `admin`, vía `@Roles`): simula lo
      que haría un webhook de billing real. El comentario en
      `OrganizationService.updatePlan()` documenta el punto de extensión
      ("una integración real reemplaza quién llama este método, no su
      cuerpo"). También `GET /organizations/me` para que el frontend sepa
      el plan actual sin decodificar el JWT a mano.
- [x] `AuditLogService` (`backend/src/common/audit/`) + decorator
      `@Audit(action, entity)` + `AuditInterceptor` aplicado por ruta
      (nunca global, a diferencia de `TenantGuard`/`TenantInterceptor` —
      solo un puñado de rutas son lo bastante sensibles para auditar).
      Escribe en `audit_log` en las cinco acciones que pedía el sprint:
      login, cambio de plan, invitación creada, cambio de rol, borrado de
      tarea. Decisión tomada: decorator + interceptor (no llamadas
      explícitas dentro de cada service), exactamente por la razón que
      este mismo roadmap anticipaba — así un endpoint nuevo no puede
      "olvidarse" de auditar silenciosamente sin que al menos quede un
      warning en los logs (ver nota de bug real más abajo).
- [x] Angular: vista de historial de auditoría (`/audit-log`, solo admin
      vía `*appHasRole` + protegida server-side), con paginación; badge de
      plan y botón para cambiarlo en el dashboard (admin), que además
      refresca la sesión local al toque para que el propio admin vea el
      efecto sin tener que desloguearse.
- [x] Tests: 3 casos e2e de plan gating (`test/plan/`), 3 de audit log
      end-to-end (`test/audit-log/`) cubriendo las cinco acciones +
      aislamiento por org + que un member no puede leer la auditoría, y
      3 negativos de RLS específicos de `audit_log`
      agregados a `test/rls/` (lectura cruzada, `WITH CHECK` en INSERT, y
      que `tenanthub_app` no puede hacer `DELETE` ahí ni para su propio
      org — el grant se revocó desde Sprint 1).

### Bug real encontrado y corregido: el audit write se perdía silenciosamente

La primera versión de `AuditInterceptor` escribía el audit log dentro de
un `tap()` de RxJS sin esperar la promesa que devuelve
`auditLog.write(...)`. `tap` no espera callbacks async — el `INSERT` corría
"en algún momento" después de que el resto del pipeline ya había seguido
su curso, así que a veces terminaba ejecutándose sobre una conexión cuya
transacción (`TenantInterceptor`'s `$transaction`) ya había hecho commit.
El síntoma: `GET /audit-log` devolvía siempre `total: 0`, sin ningún error
visible en los logs. Se encontró probando el flujo completo por HTTP real
(la misma disciplina que atrapó el bug de Sprint 2 en
`auth_accept_invitation`), no con una prueba unitaria aislada. El fix fue
cambiar `tap()` por `concatMap()` con una función async, para que el write
quede genuinamente encadenado al stream y se espere antes de que la
transacción pueda cerrarse. Ver el comentario en
`audit.interceptor.ts` y `docs/architecture.md`.

### Bug real encontrado y corregido: contaminación entre archivos de test

Al correr las nuevas suites de Sprint 5 junto con las de sprints
anteriores, empezaron a fallar tests de `memberships.e2e-spec.ts` de forma
intermitente (una membership "desaparecía" a mitad de un test). La causa:
`auth.e2e-spec.ts` (Sprint 2) limpiaba usuarios con
`user.deleteMany({ email: { contains: '@e2e.test' } })` — un dominio que
**todas** las suites comparten. Como Jest corre archivos de test en
paralelo, el `afterAll` de una suite podía borrar usuarios que otra suite,
corriendo al mismo tiempo, todavía estaba usando activamente (y `User` en
cascada borra sus `Membership`s). El fix: cada suite limpia solo sus
propias organizaciones (por prefijo único de slug), ninguna borra usuarios
por dominio de email. Ver el comentario en el `afterAll` de
`test/auth/auth.e2e-spec.ts`.

## Sprint 6 — Deploy y presentación ⬜

- [ ] Deploy del backend (Fly.io/Railway/Render — cualquiera con Postgres
      administrado; documentar cuál y por qué al elegir).
- [ ] Deploy del frontend (Vercel/Netlify/Cloudflare Pages).
- [ ] Pipeline de deploy en CI (extender `.github/workflows/`) gateado
      por los tests existentes.
- [ ] README con arquitectura y decisiones (este repo ya tiene
      `docs/architecture.md` y `docs/decisions/` — en este sprint se
      resume/enlaza desde el README principal para quien llega de un
      link de portafolio).
- [ ] Video demo: dos organizaciones en paralelo mostrando aislamiento de
      datos en vivo, un intento fallido de usar una feature de plan pro
      estando en plan free, y una entrada nueva apareciendo en el audit
      log en tiempo real.

---

## Cómo retomar el proyecto

1. Leer `docs/architecture.md` completo — explica el mecanismo de RLS y
   por qué el código está organizado como está.
2. Leer `docs/threat-model.md` para entender qué garantías existen y
   cuáles quedan como riesgo residual documentado.
3. Correr `backend/test/rls/rls.e2e-spec.ts` — si algo se rompe ahí,
   algo rompió el aislamiento entre tenants y es prioridad P0 arreglarlo
   antes de seguir con cualquier feature nueva.
4. Seguir los sprints en orden: cada uno asume que el anterior está
   terminado (Sprint 4 asume que `role` ya viaja en el JWT desde Sprint 1,
   Sprint 5 asume que `PlanGuard` puede apoyarse en el mismo patrón que
   `TenantGuard`, etc.).
