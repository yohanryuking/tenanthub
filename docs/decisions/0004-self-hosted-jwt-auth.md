# ADR 0004 — Autenticación propia (JWT + bcrypt) en vez de Supabase Auth

## Estado

Aceptada. Alcance parcial: Fase 1 implementa lo mínimo para que RLS tenga
un caller real (login básico); el flujo completo de onboarding es Sprint 2
(ver `docs/roadmap.md`).

## Contexto

Supabase Auth resolvía, en la propuesta original: hashing de passwords,
emisión/verificación de JWT, y exponer `auth.jwt()` para que las policies
de RLS lo lean directamente. Al reemplazar Supabase por Postgres estándar
(ADR 0001), nada de eso viene incluido.

## Decisión

- Passwords con `bcrypt` (costo 10), almacenados en `users.password_hash`.
- JWT propio firmado con `@nestjs/jwt`, verificado por `TenantGuard` en
  cada request no pública.
- El JWT está **atado a una organización específica** en el momento de
  emitirse (`{ sub: userId, orgId, role }`), no es un token "genérico de
  usuario" que después elige org por header — así el `orgId` nunca puede
  venir de algo que el cliente controle en la request, solo del payload
  firmado en login. Ver `docs/architecture.md` para el flujo completo.
- El login necesita resolver "¿este email+org existen y la password
  matchea?" *antes* de que exista contexto de tenant — se resuelve con
  funciones SQL `SECURITY DEFINER` angostas, no con un bypass general de
  RLS para el rol de la app. Ver ADR 0003 y `docs/threat-model.md`.

## Por qué

- Es el reemplazo directo y mínimo de lo que Supabase Auth daba gratis,
  sin traer un framework de auth de terceros (Auth0, Clerk, etc.) que
  reintroduciría la misma dependencia externa que se quiso evitar al
  dejar Supabase.
- Atar el JWT a una organización (en vez de emitir un token "de usuario" y
  resolver el tenant en cada request a partir de una lista de orgs)
  simplifica el modelo de amenazas: no hace falta razonar sobre "¿puede
  el cliente pedir actuar como una org a la que sí pertenece pero no
  debería en este momento?" — el token ya lo decidió en login.

## Consecuencias / qué falta (Sprint 2)

- Sin refresh tokens: el JWT expira a las 8h y no hay forma de renovarlo
  sin volver a loguearse. Aceptable para una demo, no para producción.
- Sin registro (`/auth/register`), sin invitaciones, sin recuperación de
  contraseña. `prisma/seed.ts` es hoy la única forma de crear
  usuarios/orgs.
- Sin rate limiting en `/auth/login` (ver `docs/threat-model.md`, riesgo
  residual documentado).
- Si un usuario pertenece a varias organizaciones (el modelo lo soporta
  desde `memberships`), hoy tiene que loguearse una vez por cada una
  (indicando `orgSlug` cada vez) — no hay todavía un "cambiar de
  organización" sin volver a autenticar con password. Se resuelve en
  Sprint 2 con `auth_list_orgs_for_email` (ya existe la función SQL, falta
  el endpoint y la UI).
