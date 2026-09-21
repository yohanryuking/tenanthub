# Modelo de amenazas — aislamiento multi-tenant

Este documento existe porque el diferenciador central del proyecto es de
seguridad, no de features: cualquiera puede escribir un CRUD; pocos
implementan y **prueban** el aislamiento entre tenants como si alguien
estuviera activamente tratando de romperlo.

## Activo a proteger

Las filas de `tasks`, `memberships`, `audit_log` y `organizations` que
pertenecen a una organización distinta de la que la request actual dice
representar.

## Atacante asumido

- Tiene credenciales válidas (email/password) para **su propia**
  organización — no es un atacante no autenticado.
- Controla completamente el cliente HTTP: puede editar cualquier header,
  query param o campo del body antes de enviarlo.
- Puede adivinar o enumerar IDs (UUID) de recursos de otras
  organizaciones (por ejemplo, los vio en un log, en una URL compartida
  por error, o los generó por fuerza bruta — para el modelo de amenazas
  asumimos que los conoce).
- **No** tiene la clave `JWT_SECRET` ni acceso directo a la base de datos.
- **No** está explotando una vulnerabilidad de la propia aplicación NestJS
  (inyección SQL, deserialización insegura, etc.) — eso es un problema
  aparte, cubierto por prácticas generales (Prisma parametriza, class-
  validator valida input), no por este documento.

## La pregunta que este proyecto responde

> Si el código de la aplicación (guard, interceptor, service, controller)
> tuviera un bug y **se le olvidara** filtrar por `org_id` en alguna
> query nueva — ¿el atacante de arriba, con esas capacidades, puede leer o
> modificar datos de otra organización?

La respuesta que este diseño busca garantizar es **no**, porque el filtro
no vive en ese código: vive en las políticas RLS de Postgres, que se
evalúan sobre *toda* query que llegue por la conexión `tenanthub_app`, la
haya escrito quien la haya escrito.

## Superficies y mitigaciones

| Superficie | Riesgo si no se mitiga | Mitigación | Evidencia |
|---|---|---|---|
| Un endpoint nuevo olvida `where: { orgId }` | Fuga de datos entre tenants | RLS evalúa `USING`/`WITH CHECK` en la base, independiente de la query de la app | `test/rls/rls.e2e-spec.ts` |
| Cliente manda `orgId` distinto en el body de un POST | El atacante fuerza que su acción se registre en otra org | El `orgId` en el JWT es la única fuente de verdad (`TenantGuard`); el service usa `tenant.orgId` del JWT, nunca del DTO. Aunque lo hiciera, `WITH CHECK` en el INSERT lo rechazaría | Test "no puede INSERT falsificando org_id" |
| Un desarrollador nuevo olvida aplicar `TenantGuard`/`TenantInterceptor` a un módulo nuevo | El request corre sin tenant context | `TenantContextService.getClient()` lanza si no hay client en el `AsyncLocalStorage` — falla ruidosamente en vez de caer a una conexión sin RLS | `tenant-context.service.ts` (sin fallback) |
| La app se conecta accidentalmente con el rol dueño de las tablas | Ese rol bypassa RLS por completo (comportamiento estándar de Postgres para owners/superusers) | `PrismaService` lanza en el arranque si `APP_DATABASE_URL` no está seteada; nunca reutiliza `DATABASE_URL` | `prisma.service.ts` |
| `app.current_org` "se filtra" entre requests concurrentes de distintos tenants | Un tenant vería el contexto de otro bajo carga | `set_config(..., true)` es transaction-local (Postgres), y el cliente que la seteó vive en un `AsyncLocalStorage` por request — no hay estado mutable compartido en el proceso de Node | Diseño en `tenant.interceptor.ts` |
| Login necesita cruzar tenants antes de que exista un tenant | Tentación de dar bypass general de RLS al rol de la app | Dos funciones `SECURITY DEFINER` (`auth_login_lookup`, `auth_list_orgs_for_email`) que solo devuelven la fila que matchea los parámetros exactos recibidos — superficie mínima y auditable en un solo archivo | `migrations/20260914213000_auth_lookup_function/` |
| Enumeración de IDs (UUID v4 no es "secreto", pero tampoco es fácil de adivinar) | Un atacante intenta acceder a un recurso por ID sin pertenecer a esa org | Cubierto arriba por RLS — el ID correcto no sirve de nada sin el `org_id` correcto en la sesión | Tests de UPDATE/DELETE "adivinando IDs" |

## Qué NO cubre este modelo de amenazas todavía (riesgo residual documentado)

- **Rate limiting / fuerza bruta sobre `/auth/login` y `/auth/refresh`**:
  no implementado todavía. Un atacante podría intentar muchas
  combinaciones de password, o intentar adivinar refresh tokens (poco
  práctico dado que son 32 bytes aleatorios, pero rate limiting es
  defensa en profundidad igual). Pendiente.
- **Rotación de `JWT_SECRET`**: un secreto filtrado permite forjar tokens
  para cualquier org/rol. No hay rotación ni lista de revocación
  todavía; la ventana de exposición de un access token forjado es ahora
  como máximo `JWT_EXPIRES_IN` (15 min desde Sprint 2, antes 8h) — bastante
  más chica, pero sigue existiendo mientras el secreto esté filtrado.
- **Reuso de un refresh token ya consumido no dispara ninguna alarma**:
  la rotación (ADR 0005) hace que reusar un token viejo falle con 401,
  pero eso es todo lo que pasa — no se revoca el resto de la sesión ni se
  notifica a nadie. Un sistema más maduro trataría "alguien reusó un
  token ya rotado" como señal fuerte de robo (alguien tiene una copia
  vieja del token) y revocaría toda la cadena de refresh tokens de ese
  usuario/org. No implementado.
- **Tokens en `localStorage` en el frontend**: tanto el access token como
  el refresh token viven en `localStorage` (`AuthService`, Sprint 2).
  Cualquier XSS en la app puede robarlos. Mitigación real (mover el
  refresh token a una cookie `httpOnly` seteada por el backend) queda
  como trabajo futuro — documentado, no resuelto.
- **El token de invitación viaja en la respuesta HTTP de
  `POST /organizations/invitations`**, no solo por email (porque no hay
  proveedor de email configurado). Quien pueda leer esa respuesta o los
  logs del servidor (donde también se loguea, a propósito, para poder
  demostrarlo sin SMTP) tiene el token. Aceptable para una demo; en
  producción con email real, dejar de devolverlo en el body.
- **Las funciones `SECURITY DEFINER`** son, por diseño, el único punto
  donde una query cruza tenants. Son el activo de mayor sensibilidad del
  esquema: cualquier cambio a ellas debería revisarse con el mismo
  cuidado que un cambio a una policy de RLS. Desde Sprint 2 son siete
  (login, listado de orgs, registro, lookup/accept de invitación, emitir/
  consumir/revocar refresh token), todas limitadas a los parámetros
  exactos recibidos (nunca exponen un listado abierto).
- **`users` no tiene RLS**: es intencional (ver `architecture.md`), pero
  significa que cualquier consulta directa a esa tabla desde código nuevo
  no tiene ninguna protección de tenant — no debería necesitarla, porque
  `users` no contiene datos de negocio, solo credenciales globales.
- **Superusuarios de infraestructura** (backups, replicación, alguien con
  acceso a la instancia de Postgres) siempre pueden ver todo — RLS protege
  contra la aplicación, no contra quien administra la base de datos. Eso
  es awareness, no algo que este proyecto intente resolver.
- **Feature flags / gating por plan** (Sprint 5) todavía no existen, así
  que hoy no hay forma de "escalar" a una feature de plan superior sin
  pagar — no es una amenaza de aislamiento de tenants, pero vale
  mencionarla porque comparte el mismo patrón de guard.

## Cómo se prueba esto en la práctica

`backend/test/rls/rls.e2e-spec.ts` corre contra un Postgres real
(no mockeado), conectándose con el rol `tenanthub_app` real, y para cada
amenaza de la tabla de arriba escribe el ataque correspondiente y afirma
que falla:

1. Lectura cruzada de `tasks` entre dos orgs.
2. Sesión sin `app.current_org` seteado no ve ninguna fila (deny-by-default).
3. `UPDATE`/`DELETE` de una fila de otra org, adivinando su UUID, afecta 0 filas.
4. `INSERT` falsificando `org_id` es rechazado por la policy `WITH CHECK`.
5. Lo mismo para `organizations`, no solo para `tasks`.

Estos tests corren en CI en cada push/PR
(`.github/workflows/backend-ci.yml`). Si alguno empieza a fallar, es una
regresión de seguridad, no un test flaky — tratarlo como P0.

`backend/test/auth/auth.e2e-spec.ts` (Sprint 2) complementa esto a nivel
de API en vez de SQL directo: entre otros casos, confirma que un token de
la organización A nunca devuelve tareas de la organización B a través del
endpoint HTTP (no solo por consulta directa), que una invitación no puede
aceptarse dos veces, que un `member` no puede invitar (403), y que un
refresh token usado dos veces falla la segunda vez. Es la misma disciplina
de "probar que el ataque falla", aplicada a los flujos que Sprint 2
agregó.
