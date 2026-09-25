/**
 * Records the Sprint 6 demo video: two organizations, plan gating, and
 * the audit log, driven against a real backend + frontend already
 * running (see docs/deploy.md's "before the demo" notes and
 * ../README.md for how to start both locally). Not a Playwright *test*
 * — no assertions, just a scripted walkthrough with on-page captions
 * standing in for narration.
 *
 * Usage: FRONTEND_URL=http://localhost:4200 node scripts/record-demo.js
 * Optional: PLAYWRIGHT_CHROMIUM_PATH to point at a pre-installed
 * Chromium instead of Playwright's own download (see playwright.config.ts).
 */
const { chromium } = require('@playwright/test');
const path = require('path');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';
const VIDEO_DIR = path.join(__dirname, '..', 'demo-recording');

async function caption(page, text, ms = 1800) {
  await page.evaluate((t) => {
    let el = document.getElementById('__demo_caption');
    if (!el) {
      el = document.createElement('div');
      el.id = '__demo_caption';
      Object.assign(el.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        zIndex: '999999',
        background: '#1f2933',
        color: 'white',
        padding: '14px 20px',
        fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
        fontSize: '18px',
        fontWeight: '600',
        textAlign: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      });
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
  await page.waitForTimeout(ms);
}

async function clearCaption(page) {
  await page.evaluate(() => {
    const el = document.getElementById('__demo_caption');
    if (el) el.remove();
  });
}

(async () => {
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  );
  const suffix = Date.now().toString().slice(-6);
  const acmeSlug = `demo-acme-${suffix}`;
  const globexSlug = `demo-globex-${suffix}`;

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();

  // ---------- Org A: Acme, registro y primer contacto con el plan gate ----------
  await page.goto(`${FRONTEND_URL}/register`, { waitUntil: 'networkidle' });
  await caption(page, 'TenantHub — demo: dos organizaciones, aislamiento total');
  await page.fill('input[formcontrolname="orgName"]', 'Acme Inc');
  await page.fill('input[formcontrolname="orgSlug"]', acmeSlug);
  await page.fill('input[formcontrolname="email"]', `admin@${acmeSlug}.test`);
  await page.fill('input[formcontrolname="password"]', 'password123');
  await caption(page, 'Registrando la organización "Acme" — queda en plan Free por defecto');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 10000 });
  await caption(page, 'Acme está en plan Free (ver el badge junto al rol)');

  await page.click('a:has-text("Ver tareas")');
  await page.waitForURL('**/tasks');
  await page.fill('input[formcontrolname="title"]', 'Preparar propuesta para cliente');
  await page.click('.add-form button[type=submit]');
  await page.waitForSelector('.task-list li');
  await caption(page, 'Exportar a CSV es una feature de plan Pro — Acme está en Free…');
  await page.click('.export-button');
  await page.waitForSelector('.error', { timeout: 5000 });
  await caption(page, '…y el backend lo bloquea con 403, no solo la UI', 2200);

  await page.click('a:has-text("Volver")');
  await page.waitForURL('**/dashboard');
  await caption(page, 'El admin de Acme decide pasar a Pro (simula un webhook de billing)');
  await page.click('button:has-text("Pasar a Pro")');
  await page.waitForTimeout(1000);
  await caption(page, 'La sesión se refresca sola — el badge ya dice "pro"');

  await page.click('a:has-text("Ver tareas")');
  await page.waitForURL('**/tasks');
  await caption(page, 'Ahora el export funciona: mismo botón, plan distinto');
  await page.click('.export-button');
  await page.waitForTimeout(1200);

  await page.click('a:has-text("Volver")');
  await page.waitForURL('**/dashboard');
  await page.click('a:has-text("Ver auditoría")');
  await page.waitForURL('**/audit-log');
  await page.waitForSelector('table', { timeout: 5000 });
  await caption(page, 'La auditoría ya registró el cambio de plan — sin código extra en el service');
  await clearCaption(page);
  await page.waitForTimeout(1500);

  // ---------- Invitación → nueva entrada de auditoría en vivo ----------
  await page.click('a:has-text("Volver")');
  await page.waitForURL('**/dashboard');
  await caption(page, 'Invitamos a un miembro — eso también queda auditado');
  await page.fill('.card:has-text("Invitar") input[type=email]', `member@${acmeSlug}.test`);
  await page.click('.card:has-text("Invitar") button[type=submit]');
  await page.waitForSelector('.result', { timeout: 5000 });
  await clearCaption(page);

  await page.click('a:has-text("Ver auditoría")');
  await page.waitForURL('**/audit-log');
  await page.waitForSelector('table', { timeout: 5000 });
  await caption(page, 'La invitación aparece de inmediato en el historial de Acme');
  await page.waitForTimeout(1200);
  await clearCaption(page);

  // ---------- Logout, Org B: Globex — aislamiento total ----------
  await page.click('a:has-text("Volver")').catch(() => {});
  await page.goto(`${FRONTEND_URL}/dashboard`, { waitUntil: 'networkidle' });
  await caption(page, 'Cerramos sesión de Acme y creamos una segunda organización: Globex');
  await page.click('.logout');
  await page.waitForURL('**/login');

  await page.goto(`${FRONTEND_URL}/register`, { waitUntil: 'networkidle' });
  await page.fill('input[formcontrolname="orgName"]', 'Globex Corp');
  await page.fill('input[formcontrolname="orgSlug"]', globexSlug);
  await page.fill('input[formcontrolname="email"]', `admin@${globexSlug}.test`);
  await page.fill('input[formcontrolname="password"]', 'password123');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 10000 });
  await caption(page, 'Globex es una organización nueva y totalmente separada — plan Free propio');

  await page.click('a:has-text("Ver tareas")');
  await page.waitForURL('**/tasks');
  await caption(page, 'La lista de tareas de Globex está vacía: nunca ve nada de Acme');
  await page.waitForTimeout(1500);
  await clearCaption(page);

  await page.click('a:has-text("Volver")');
  await page.waitForURL('**/dashboard');
  await page.click('a:has-text("Ver auditoría")');
  await page.waitForURL('**/audit-log');
  await page.waitForSelector('table, .empty', { timeout: 5000 });
  await caption(page, 'Y la auditoría de Globex está vacía — ni una fila de Acme se filtró acá');
  await page.waitForTimeout(1800);
  await caption(page, 'Row-Level Security en Postgres — no un WHERE en el backend', 2500);

  await context.close();
  await browser.close();

  console.log('Video guardado en', VIDEO_DIR);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
