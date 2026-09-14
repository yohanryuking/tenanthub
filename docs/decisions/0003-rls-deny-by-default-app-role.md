# ADR 0003 — RLS deny-by-default + rol de aplicación no-owner

## Estado

Aceptada.

## Contexto

Postgres soporta Row-Level Security desde la 9.5, pero tiene dos
comportamientos que son fáciles de pasar por alto y que rompen la garantía
de aislamiento si no se manejan explícitamente:

1. Los **dueños de tabla y los superusuarios bypassan RLS por defecto**,
   incluso con `ENABLE ROW LEVEL SECURITY` puesto. Hace falta
   `FORCE ROW LEVEL SECURITY` para que ni siquiera el owner escape — o,
   alternativamente, no conectar la aplicación como owner.
2. Una policy sin `USING`/`WITH CHECK` bien pensada puede terminar
   "permitiendo por accidente" en vez de negar por defecto (por ejemplo,
   comparar contra un valor que puede ser `NULL` con una lógica que
   evalúa a `true` en vez de `false` cuando falta el contexto).

## Decisión

- La aplicación (`APP_DATABASE_URL`) se conecta como `tenanthub_app`, un
  rol `LOGIN` que **no es dueño de ninguna tabla**. Como no es owner ni
  superuser, Postgres le aplica RLS siempre — no hace falta
  `FORCE ROW LEVEL SECURITY` ni acordarse de nada adicional.
- Las migraciones (`DATABASE_URL`) corren como el rol dueño (`postgres`
  localmente). Ese rol bypassa RLS, lo cual es intencional: las
  migraciones necesitan poder crear/alterar cualquier cosa.
- Cada policy usa `current_setting('app.current_org', true)` — el segundo
  argumento `true` hace que devuelva `NULL` en vez de lanzar error cuando
  la variable no está seteada. Una comparación `org_id = NULL` en SQL
  nunca es `true`, así que una sesión que no seteó `app.current_org` no ve
  ni puede escribir ninguna fila. Deny-by-default sin tener que escribir
  un `CASE` explícito para el caso "no seteado".

## Por qué (y qué se descartó)

- **Alternativa descartada: `FORCE ROW LEVEL SECURITY` + conectar siempre
  como owner.** Funciona, pero es más frágil: cualquier conexión nueva
  que alguien agregue con el rol owner (un script de debug, una
  herramienta de admin) vuelve a bypassar RLS silenciosamente a menos que
  se acuerde de `FORCE`. Separar los roles hace la garantía estructural
  en vez de dependiente de que alguien no se olvide de un flag.
- **Alternativa descartada: filtrar por `org_id` en el ORM/repositorio**
  (el enfoque "de toda la vida"). Es exactamente lo que este proyecto
  existe para NO hacer — un `WHERE` olvidado en un método nuevo es una
  fuga de datos silenciosa. Ver `docs/threat-model.md`.

## Consecuencias

- Cualquier script, seed o herramienta de administración que necesite ver
  entre tenants debe conectarse explícitamente con el rol owner
  (`DATABASE_URL`), nunca con `tenanthub_app`. `prisma/seed.ts` es el
  ejemplo — usa el `PrismaClient` por defecto (owner), no `PrismaService`.
- Dar de alta un nuevo rol de aplicación (por ejemplo, un worker en
  background para Sprint 5) requiere repetir el mismo patrón de GRANT
  explícito en una migración — no hay una forma "automática" de que un
  rol nuevo herede las políticas correctas, y eso es deliberado (obliga a
  pensar explícitamente qué puede ver cada rol nuevo).
