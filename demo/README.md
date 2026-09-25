# Video demo

`tenanthub-demo.webm` (~43s) — grabado automáticamente con Playwright
contra el backend y frontend reales corriendo en local (no mockeado, no
edición posterior más allá de guardar el archivo que Playwright generó).
Las leyendas superpuestas están inyectadas por el propio script de
grabación (no hay narración en audio).

Genera la misma demo vos mismo con `frontend/scripts/record-demo.js` (ver
el script para el detalle exacto de cada paso):

```bash
# con el backend corriendo en :3000 y el frontend en :4200
cd frontend
node scripts/record-demo.js
# el .webm queda en frontend/demo-recording/
```

## Qué muestra, en orden

1. Registro de una organización nueva ("Acme"), plan `free` por defecto.
2. Intento de exportar tareas a CSV en plan `free` → bloqueado con 403
   (`PlanGuard`/`@RequiresPlan('pro')`, Sprint 5).
3. Un admin cambia el plan a `pro` (simulando un webhook de billing) → la
   sesión se refresca sola y el export empieza a funcionar.
4. La auditoría (`/audit-log`) ya tiene el cambio de plan registrado.
5. Se invita a un miembro → la invitación aparece en la auditoría
   inmediatamente después.
6. Se cierra sesión y se crea una segunda organización ("Globex"),
   completamente independiente: su lista de tareas y su auditoría están
   vacías — nunca ven nada de Acme, aunque ambas corren sobre la misma
   base de datos al mismo tiempo. Esa separación la garantiza Row-Level
   Security en Postgres, no un filtro en el código de la aplicación (ver
   `docs/architecture.md`).
