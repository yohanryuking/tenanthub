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

## Sprint 2 — Auth y onboarding ⬜

Objetivo: pasar de "hay un login mínimo" a un flujo de onboarding real.

- [ ] `POST /auth/register`: crea `User` + `Organization` + `Membership`
      (rol `admin`) en una sola transacción — "regístrate y te creamos tu
      workspace", como Slack/Notion/Linear.
- [ ] `GET /auth/orgs?email=...` usando la función SQL
      `auth_list_orgs_for_email` (ya existe en la migración de Sprint 1,
      sin endpoint todavía) para que el login pueda ofrecer un selector de
      organización en vez de pedir el slug a mano.
- [ ] Invitaciones: `POST /organizations/:id/invitations` (solo `admin`),
      genera un token de invitación de un solo uso, con expiración.
      Envío de email fuera de alcance de un entorno real de SMTP — usar
      un stub/logger en dev, dejar el punto de extensión documentado
      (mismo patrón que "aquí conectaría Stripe" del Sprint 5).
- [ ] `POST /auth/invitations/:token/accept`: crea `Membership` para un
      usuario existente o nuevo.
- [ ] Refresh tokens / expiración razonable del JWT actual (hoy expira a
      las 8h sin refresh — suficiente para demo, no para producción).
- [ ] Angular: pantallas de login, registro, selector de organización,
      guard de ruta que redirige a `/login` si no hay token válido.
- [ ] Tests: registro crea exactamente 1 membership con rol admin;
      invitación expirada no puede aceptarse; un usuario no puede
      aceptar dos veces la misma invitación.

## Sprint 3 — Feature core del SaaS ⬜

El dominio de ejemplo (`tasks`) ya existe a nivel de esquema + API mínima
desde Sprint 1; este sprint es donde se vuelve un feature real de producto.

- [ ] Backend: `PATCH /tasks/:id`, `DELETE /tasks/:id`, paginación,
      filtros (`done`, texto), validación de que el `:id` pertenece al
      tenant actual (ya lo garantiza RLS, pero el endpoint debe devolver
      404 en vez de un error crudo de Postgres).
- [ ] Angular: listado con `tasks.component`, formulario reactivo de
      creación/edición, guard de autenticación en las rutas, interceptor
      HTTP que agrega el JWT a cada request y maneja 401 (logout
      automático).
- [ ] Tests e2e de Angular (Playwright o Cypress — decidir cuál al
      empezar el sprint) para el flujo crear→ver→editar→completar tarea.

## Sprint 4 — Roles y permisos ⬜

- [ ] Guard de NestJS `RolesGuard` + decorator `@Roles('admin')` que lee
      `request.tenant.role` (ya viaja en el JWT desde Sprint 1) para
      restringir endpoints (ej. solo `admin` puede invitar miembros o
      cambiar el plan).
- [ ] Angular: directiva estructural `*appHasRole="'admin'"` para ocultar
      UI que el usuario no puede usar (además del guard de backend — la
      UI nunca es la única barrera).
- [ ] Endpoint para que un `admin` cambie el rol de otro miembro
      (`PATCH /memberships/:id`), con la regla de que una organización no
      puede quedarse sin ningún admin.
- [ ] Tests de autorización: un `member` que llama un endpoint
      admin-only recibe 403; un admin no puede degradarse a sí mismo si es
      el único admin restante.

## Sprint 5 — Planes, feature flags y audit log ⬜

- [ ] `PlanGuard` + decorator `@RequiresPlan('pro')`: bloquea acciones
      (ejemplo concreto: `GET /tasks/export.csv`) si `organization.plan`
      no alcanza. La columna `plan` ya existe en `organizations` desde
      Sprint 1.
- [ ] `PATCH /organizations/:id/plan` (solo `admin`): simula lo que haría
      un webhook de billing real. Documentar en el propio endpoint el
      punto de extensión ("aquí conectaría Stripe/webhook real").
- [ ] Servicio de auditoría (`AuditLogService`) que escribe en `audit_log`
      (tabla y RLS ya existen desde Sprint 1) en cada acción sensible:
      login, cambio de plan, invitación, cambio de rol, borrado de task.
  - Decisión pendiente: ¿interceptor global que audita automáticamente
    marcado por decorator (`@Audit('task.created')`), o llamada explícita
    dentro de cada service? Recomendado: decorator + interceptor, para no
    poder "olvidarse" de auditar un endpoint nuevo — mismo principio de
    diseño que ya se usó para RLS (fail loud, no fallback silencioso).
- [ ] Angular: vista de historial de auditoría por organización (solo
      admin), con paginación.
- [ ] Tests: acción restringida por plan falla en `free` y funciona en
      `pro`; cada acción sensible efectivamente deja una fila en
      `audit_log`; `audit_log` respeta RLS igual que el resto (ya probado
      a nivel de política en Sprint 1, falta probar a nivel de la
      escritura real de la aplicación).

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
