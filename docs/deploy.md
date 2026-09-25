# Deploy — TenantHub

> **Estado**: esta guía y la configuración que referencia (`render.yaml`,
> `backend/Dockerfile`, `frontend/vercel.json`, los jobs `deploy` en
> `.github/workflows/`) están escritas y listas para usar, pero **nadie
> las ejecutó todavía** — este entorno de desarrollo no tiene credenciales
> de ningún proveedor de hosting. Lo que sigue es exactamente lo que
> correrías vos (o quien tenga las cuentas) para poner esto en producción,
> no un resumen de algo ya hecho.

## Por qué Render + Vercel

- **Backend: [Render](https://render.com)**. Da Postgres administrado y
  un servicio web a partir de un `Dockerfile` en el mismo blueprint
  (`render.yaml`), sin necesitar una CLI para el primer deploy — importás
  el repo y Render lee el blueprint solo. Alternativas consideradas:
  Fly.io (requiere su CLI para el primer deploy, más control pero más
  fricción) y Railway (blueprint propietario, no un archivo versionable
  como `render.yaml`).
- **Frontend: [Vercel](https://vercel.com)**. Detecta Angular
  automáticamente, y `frontend/vercel.json` ya tiene el rewrite que un SPA
  con `RouterModule` necesita (toda ruta sirve `index.html`, para que
  refrescar `/tasks` no dé 404). Netlify y Cloudflare Pages son
  equivalentes; se eligió Vercel por ser la opción con menos
  configuración manual para un build de Angular.

## 1. Backend en Render

1. Pusheá esta rama a GitHub (ya está en `main`).
2. En el dashboard de Render: **New → Blueprint**, conectá el repo. Render
   lee `render.yaml` en la raíz y propone crear:
   - una base Postgres administrada (`tenanthub-db`),
   - un servicio web Docker (`tenanthub-backend`) construido desde
     `backend/Dockerfile`.
3. Aceptá y dejá que corra el primer deploy. **Va a arrancar pero
   fallar en runtime** hasta el paso 4 — `APP_DATABASE_URL` queda sin
   setear a propósito (`sync: false` en el blueprint), así nadie despliega
   por accidente con la app corriendo bajo el rol que puede hacer bypass
   de RLS.

### Rotar la contraseña de `tenanthub_app` (obligatorio, no opcional)

La migración de RLS crea el rol `tenanthub_app` con la contraseña de
desarrollo `tenanthub_app` (la misma que `backend/.env.example`). Nunca
uses esa contraseña fuera de tu máquina.

```bash
# Password fuerte y aleatorio
openssl rand -base64 24

# Conectate a la DB de Render con el rol owner (Render te da esta connection
# string en el dashboard de tenanthub-db, o usá $DATABASE_URL del servicio web)
psql "$DATABASE_URL" -c "ALTER ROLE tenanthub_app WITH PASSWORD '<el password generado>';"
```

Después, en el dashboard del servicio web (`tenanthub-backend` → Environment),
seteá `APP_DATABASE_URL` a la misma connection string que `DATABASE_URL`
pero con `tenanthub_app` como usuario y el password nuevo:

```
postgresql://tenanthub_app:<password nuevo>@<mismo host>/<misma db>
```

Guardá y dejá que Render redeploye. Confirmá con:

```bash
curl https://<tu-servicio>.onrender.com/health
# {"status":"ok","service":"tenanthub-backend"}
```

### `JWT_SECRET`

`render.yaml` lo marca `generateValue: true` — Render genera un secreto
aleatorio único en el primer deploy. Si alguna vez se filtra, rotarlo
invalida todos los tokens vigentes (todos los usuarios tienen que volver
a loguearse).

### `CORS_ORIGIN`

Dejalo vacío hasta tener la URL del frontend (paso 2). Un `CORS_ORIGIN`
vacío refleja cualquier origen — no es el estado final, es el estado
mientras el frontend todavía no existe.

## 2. Frontend en Vercel

1. Antes de importar el proyecto, editá
   `frontend/src/environments/environment.ts` con la URL real del backend
   del paso 1:
   ```ts
   export const environment = {
     production: true,
     apiUrl: 'https://<tu-servicio>.onrender.com',
   };
   ```
   Commiteá ese cambio — Angular lee este archivo en tiempo de build, no
   en runtime, así que tiene que estar en el repo antes del build de
   Vercel.
2. En el dashboard de Vercel: **Add New → Project**, importá el repo,
   **Root Directory: `frontend`**. Vercel detecta `vercel.json` (build
   command, output directory, y el rewrite del SPA) automáticamente.
3. Deploy. Probá `/register`, `/login`, y que refrescar `/tasks` no dé 404
   (confirma que el rewrite está andando).
4. Volvé a Render y seteá `CORS_ORIGIN` a la URL que te dio Vercel
   (`https://tenanthub.vercel.app`, por ejemplo). Redeploy del backend.

## 3. CI/CD gateado por los tests

`.github/workflows/backend-ci.yml` y `frontend-ci.yml` ya tienen un job
`deploy` que solo corre si el job de tests pasó, y solo en push a `main`.
Sin los secrets configurados, ese job hace un no-op explícito (lo vas a
ver en los logs de Actions: "secret not set — skipping deploy") en vez de
fallar — así el pipeline queda verde aunque el hosting todavía no exista.

Para activarlo:

1. **Render**: `tenanthub-backend` → Settings → **Deploy Hook** → copiá la URL.
2. **Vercel**: proyecto → Settings → Git → **Deploy Hooks** → creá uno para
   `main` → copiá la URL.
3. En GitHub: repo → Settings → Secrets and variables → Actions, agregá:
   - `RENDER_DEPLOY_HOOK`
   - `VERCEL_DEPLOY_HOOK`
4. **Importante**: desactivá el auto-deploy nativo de Render y Vercel en
   push a `main` (ambos lo tienen prendido por defecto). Si no lo hacés,
   van a deployar igual aunque los tests de GitHub Actions fallen — el
   deploy hook deja de ser el único gate.

Con eso: `git push origin main` → corre `backend-ci`/`frontend-ci` → si
todo pasa, cada uno pega su deploy hook → Render/Vercel levantan la nueva
versión.

## 4. Cosas para saber antes de la demo

- **Cold starts**: el plan free de Render duerme el servicio tras 15
  minutos sin tráfico; el primer request después de eso tarda ~30-60s en
  responder. Para una demo en vivo, hacé un request de calentamiento
  (`curl .../health`) unos minutos antes.
- **Rollback**: Render → Deploys → elegí un deploy anterior → "Rollback".
  Vercel → Deployments → elegí uno anterior → "Promote to Production".
- **Nada de esto reemplaza rotar `JWT_SECRET`/`APP_DATABASE_URL`
  periódicamente en un entorno real** — acá quedan fijos una vez
  configurados porque es un proyecto de portfolio, no un servicio con
  rotación de secretos automatizada.

## 5. Qué falta si esto fuera a producción de verdad

Ver `docs/threat-model.md` para la lista completa de riesgo residual
(rate limiting, rotación de secretos, etc.) — nada de eso es específico
del deploy, ya estaba documentado antes de este sprint. Lo único nuevo acá:
`PATCH /organizations/plan` (Sprint 5) sigue sin validar ningún pago real;
desplegar esto tal cual expone un botón "cambiar mi plan a pro gratis" a
cualquier admin, lo cual es exactamente el punto para una demo, pero
nunca debería llegar a un entorno con usuarios pagando de verdad sin
conectar antes un proveedor de billing real.
