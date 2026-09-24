import { Page, expect } from '@playwright/test';

/** Registers a brand-new organization through the real UI and lands on /dashboard. */
export async function registerNewOrg(page: Page) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const slug = `pw-${suffix}`;
  const email = `admin-${suffix}@pw.test`;

  await page.goto('/register');
  await page.fill('input[formcontrolname="orgName"]', `Playwright Org ${suffix}`);
  await page.fill('input[formcontrolname="orgSlug"]', slug);
  await page.fill('input[formcontrolname="email"]', email);
  await page.fill('input[formcontrolname="password"]', 'password123');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');

  return { slug, email };
}

export async function goToTasks(page: Page) {
  await page.click('a:has-text("Ver tareas")');
  await page.waitForURL('**/tasks');
  await expect(page.locator('h1')).toHaveText('Tareas');
}
