# ADR 0005 — Refresh tokens opacos y rotados, no JWT de larga duración

## Estado

Aceptada.

## Contexto

ADR 0004 dejó el JWT de acceso con una expiración larga (8h) y sin forma de
revocarlo antes de que expire — aceptable para demostrar RLS en Fase 1,
pero no para un flujo de sesión real: un JWT robado sigue siendo válido
hasta que expira, sin que el servidor pueda hacer nada al respecto.

## Decisión

- El **access token** (JWT) ahora expira en 15 minutos
  (`JWT_EXPIRES_IN`). Sigue siendo el que se manda en
  `Authorization: Bearer` y el que `TenantGuard` verifica — nada cambia ahí.
- Un **refresh token** separado sostiene la sesión: es una cadena aleatoria
  opaca de 32 bytes (no un JWT — no hay nada que decodificar), generada con
  `crypto.randomBytes`. Solo su hash SHA-256 se guarda en la tabla
  `refresh_tokens`; el valor crudo existe únicamente en la respuesta HTTP y
  en el storage del cliente.
- **Rotación en cada uso**: `POST /auth/refresh` consume el refresh token
  (lo marca `revoked_at = now()` atómicamente dentro de
  `auth_consume_refresh_token()`) y emite un par nuevo. El token viejo deja
  de servir inmediatamente — si alguien lo reutiliza (porque lo robó, o
  porque hubo una carrera de dos requests), ambos fallan después del
  primer uso exitoso, lo cual es una señal detectable de robo de token (no
  implementada todavía: revocar toda la sesión si un token ya consumido
  se reintenta — ver riesgo residual en `docs/threat-model.md`).
- `POST /auth/logout` revoca el refresh token explícitamente.

## Por qué

- **Ventana de exposición corta para el token que de verdad importa**: si
  el access token se filtra (log, error de cliente, XSS de corta vida),
  expira en minutos. El refresh token vive más tiempo pero nunca viaja en
  cada request — solo en la llamada a `/auth/refresh`.
- **Revocable de verdad**: un JWT no se puede "invalidar" sin mantener una
  lista de revocación (justamente lo que este diseño evita para el access
  token, dejándolo corto en cambio). El refresh token sí es una fila de
  base de datos: revocarlo es un `UPDATE`, y `logout` lo hace explícito.
- **Opaco en vez de JWT para el refresh**: no hay razón para que el
  refresh token cargue un payload decodificable — nadie más que el propio
  backend lo interpreta, y como string aleatorio no tiene superficie de
  ataque de "¿qué pasa si alguien lo decodifica y edita el payload?" (no
  aplica, no hay payload).
- **Mismo patrón de `SECURITY DEFINER` angosto que login**: emitir/consumir
  refresh tokens no tiene contexto de tenant todavía (es, otra vez,
  la operación que establece ese contexto), así que sigue el patrón de
  ADR 0003/`auth_login_lookup`: funciones SQL angostas
  (`auth_issue_refresh_token`, `auth_consume_refresh_token`,
  `auth_revoke_refresh_token`) en vez de un bypass general de RLS para
  `tenanthub_app`.

## Consecuencias

- El cliente (Angular) tiene que manejar dos tokens en vez de uno, y
  reintentar una request que dio 401 después de refrescar
  (`src/app/core/auth/auth.interceptor.ts`). Es más código que "un JWT
  largo y listo", a cambio de una superficie de robo mucho menor.
- **No hay detección activa de reuso de un refresh token ya consumido**
  todavía — el request simplemente falla con 401. Un sistema más maduro
  trataría ese caso como señal de robo y revocaría toda la familia de
  tokens del usuario. Documentado como riesgo residual, no implementado
  (ver `docs/threat-model.md`).
- Los refresh tokens viven en `localStorage` en el cliente (ver ADR 0004 y
  `docs/threat-model.md`): siguen siendo robables vía XSS. Rotarlos reduce
  el daño de una filtración pasiva (un token en un log viejo, por
  ejemplo) pero no de una filtración activa en tiempo real.
