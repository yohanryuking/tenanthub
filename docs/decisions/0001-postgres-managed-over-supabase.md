# ADR 0001 — PostgreSQL "normal" en vez de Supabase

## Estado

Aceptada.

## Contexto

La propuesta original de este proyecto usaba Supabase (Postgres
administrado + Auth + RLS + APIs autogeneradas) como forma rápida de tener
Postgres con RLS y autenticación sin operar infraestructura. El
requerimiento de esta fase es no depender de Supabase específicamente,
usando en su lugar "la base de datos que más se adapte al stack".

## Decisión

Usar PostgreSQL estándar (16.x), accedido vía Prisma desde NestJS, sin
ninguna dependencia del SDK ni de las APIs de Supabase. El proyecto sigue
usando **RLS como mecanismo de aislamiento** — eso no cambia — solo cambia
quién opera Postgres y cómo se llega a él.

En desarrollo local: Postgres vía `docker-compose.yml`. En CI: Postgres
como servicio de GitHub Actions. En producción (Sprint 6): cualquier
Postgres administrado compatible con RLS estándar (RDS, Cloud SQL, Neon,
Fly Postgres, el propio Supabase-solo-como-Postgres si se quisiera —
la decisión es agnóstica del proveedor).

## Por qué

- **Supabase es una capa sobre Postgres, no un motor distinto**: su RLS es
  el mismo mecanismo de Postgres (`CREATE POLICY ... USING (...)`). Quitar
  Supabase no cambia el diseño central del proyecto, solo obliga a
  implementar explícitamente lo que Supabase da gratis (principalmente
  Auth).
- **Portabilidad**: un Postgres estándar corre igual en cualquier
  proveedor o self-hosted. No hay vendor lock-in en la capa de datos.
- **Valor de portafolio**: implementar Auth propio (JWT + bcrypt) y el
  manejo explícito de roles de base de datos (`tenanthub_app` vs. rol
  dueño) demuestra un nivel de comprensión de Postgres/seguridad que
  usar `supabase.auth.signIn()` no demuestra — es más código, pero es
  código que muestra el mecanismo en vez de escondrelo detrás de un SDK.

## Consecuencias

- Auth deja de ser gratis: hay que implementar login, hashing de
  passwords, emisión/verificación de JWT (ver ADR 0004).
- No hay "Realtime" ni "Storage" gratis de Supabase — si se necesitaran
  más adelante, son decisiones aparte (fuera de alcance de esta fase).
- El equipo es responsable de operar/backupear Postgres en producción
  (Sprint 6 debe elegir explícitamente un proveedor administrado en vez
  de asumir que "ya viene incluido").
