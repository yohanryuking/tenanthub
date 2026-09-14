# ADR 0002 — Prisma como capa de acceso a datos y migraciones

## Estado

Aceptada.

## Contexto

Al quitar Supabase (ADR 0001) hay que elegir cómo NestJS habla con
Postgres: cliente `pg` crudo, TypeORM, Prisma, o Kysely/Drizzle.

## Decisión

Prisma (`@prisma/client` + `prisma migrate`) para el esquema, las
migraciones versionadas y las queries CRUD normales. Las partes que Prisma
no modela bien (políticas RLS, roles de Postgres, funciones
`SECURITY DEFINER`) se escriben como SQL crudo dentro de migraciones de
Prisma (`prisma/migrations/**/migration.sql`), no fuera de su control de
versiones.

## Por qué

- **Migraciones versionadas de verdad**: cada cambio de esquema (incluido
  el SQL crudo de RLS) queda en una carpeta con timestamp, aplicable en
  cualquier entorno con `prisma migrate deploy`. Esto es lo que hace que
  CI pueda levantar un Postgres vacío y llegar al mismo estado que local.
- **Tipado end-to-end**: el cliente generado da autocompletado y errores
  de compilación si el código de NestJS usa un campo que no existe — valor
  real en un proyecto que ya usa TypeScript estricto en todo el backend.
- **No pelea con RLS**: Prisma no tiene opinión sobre RLS, lo cual es
  exactamente lo que se necesita — el ORM modela la forma de las tablas,
  el archivo de migración de al lado modela quién puede ver qué fila. Ver
  el comentario al inicio de `prisma/schema.prisma` sobre esta separación
  de responsabilidades.
- Alternativa considerada, **TypeORM**: también viable y con integración
  "oficial" más estrecha con NestJS vía decoradores, pero su sistema de
  migraciones es más laxo (permite tanto migraciones generadas como
  sincronización automática de esquema, lo cual es fácil de usar mal en
  un proyecto donde la disciplina de migraciones importa). Prisma fuerza
  el flujo correcto por diseño.

## Consecuencias

- Cada política RLS, rol o función `SECURITY DEFINER` vive en SQL crudo
  dentro de una migración de Prisma — quien la lea tiene que saber leer
  SQL, no solo el schema de Prisma. Esto es intencional: es la parte más
  sensible en seguridad del proyecto y no debería estar oculta detrás de
  una abstracción.
- El cliente de Prisma en runtime (`PrismaService`) se instancia con
  `APP_DATABASE_URL` explícitamente — nunca con la URL por defecto que usa
  `prisma migrate` — precisamente para no mezclar el rol de migración
  (bypassa RLS) con el rol de runtime (no bypassa RLS). Ver ADR 0003.
