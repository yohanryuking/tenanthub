# ADR 0006 — Plan en el JWT + audit log vía decorator vs. interceptor

## Estado

Aceptada.

## Contexto

Sprint 5 necesitaba dos mecanismos nuevos: (1) bloquear una acción según
el plan de la organización, y (2) dejar un registro de auditoría de un
puñado de acciones sensibles. Ambos necesitaban encajar en los patrones ya
establecidos (`TenantGuard`/`RolesGuard`) sin comprometer el modelo de RLS.

## Decisión 1: el plan viaja en el JWT, igual que el rol

`PlanGuard`/`@RequiresPlan('pro')` lee `request.tenant.plan`, un claim
agregado al token en las cuatro funciones SQL que lo emiten. La
alternativa — consultar `organizations.plan` en cada request — se
descartó por la misma razón que Sprint 4 ya había resuelto para el rol:
mantener el JWT stateless. El costo es el mismo trade-off ya aceptado:
un cambio de plan tarda hasta el próximo refresh/login en reflejarse.

## Decisión 2: audit log vía decorator + interceptor, no llamadas explícitas

Se consideraron dos diseños:

1. Cada service llama explícitamente a `auditLog.write(...)` donde
   corresponda.
2. Un decorator (`@Audit(action, entity)`) + un interceptor que escribe
   automáticamente después de que el handler responde.

Se eligió (2) por la misma razón de diseño que llevó a
`TenantContextService.getClient()` a lanzar en vez de tener un fallback
silencioso: un endpoint nuevo que necesita auditoría y no la tiene se
nota (el interceptor no está aplicado → no hay decorator que lo respalde
→ warning en los logs), en vez de depender de que cada desarrollador se
acuerde de agregar una línea a mano en el service correcto.

`AuditInterceptor` se aplica **por ruta**, nunca global — a diferencia de
`TenantGuard`/`TenantInterceptor`. Solo cinco acciones son lo bastante
sensibles para auditar; aplicarlo globalmente auditaría cada `GET /tasks`
sin agregar señal, solo ruido.

## Decisión 3 (corrección durante el desarrollo): `concatMap`, no `tap`

La primera implementación escribía el audit log dentro de un `tap()` de
RxJS. `tap()` no espera promesas — el efecto se dispara pero el stream
sigue su curso sin esperarlo. Como `AuditInterceptor` corre anidado dentro
de la transacción que abre `TenantInterceptor`, esto significaba que el
`INSERT` a veces se ejecutaba después de que esa transacción ya había
hecho `COMMIT`, perdiendo la fila en silencio (sin ningún error visible).

Se encontró probando el flujo completo por HTTP (`GET /audit-log` volvía
siempre vacío), no con un test unitario del interceptor en aislamiento.
El fix — `concatMap()` con una función async que espera el `write()` y
después reemite el resultado original — hace que el interceptor
"pertenezca" genuinamente a la cadena async que `TenantInterceptor` espera
antes de comitear. Ver el comentario en `audit.interceptor.ts`.

## Consecuencias

- Agregar auditoría a un endpoint nuevo requiere acordarse de dos cosas
  (`@Audit(...)` y `@UseInterceptors(AuditInterceptor)`), no una — un
  costo de ergonomía a cambio de que ninguna de las dos por sí sola haga
  nada (fail-safe: si falta el interceptor, el decorator no hace nada; si
  falta el decorator, el interceptor solo loguea un warning y sigue).
- El login sigue siendo la única acción auditada con un camino distinto
  (`writeCrossTenant`, sin decorator/interceptor) porque no tiene tenant
  context — está documentado en el propio código, no oculto.
- Cualquier interceptor futuro que combine efectos secundarios async con
  el patrón `TenantInterceptor` debería usar `concatMap`/`mergeMap` (o
  esperar explícitamente), nunca `tap`, si ese efecto necesita ocurrir
  antes de que la transacción envolvente cierre.
