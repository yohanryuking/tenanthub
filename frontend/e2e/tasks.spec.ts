import { test, expect } from '@playwright/test';
import { goToTasks, registerNewOrg } from './helpers';

test.describe('Tasks (Sprint 3 golden path)', () => {
  test('crea, edita, marca como completada y elimina una tarea', async ({ page }) => {
    await registerNewOrg(page);
    await goToTasks(page);

    // crear
    await page.fill('input[formcontrolname="title"]', 'Comprar café');
    await page.click('.add-form button[type=submit]');
    const row = page.locator('.task-list li', { hasText: 'Comprar café' });
    await expect(row).toBeVisible();

    // ver: aparece en la lista sin filtros
    await expect(page.locator('.task-list li')).toHaveCount(1);

    // editar (inline)
    await row.locator('.title').click();
    await page.fill('.task-list li .edit-input', 'Comprar café en grano');
    await page.keyboard.press('Enter');
    await expect(page.locator('.task-list li', { hasText: 'Comprar café en grano' })).toBeVisible();

    // completar
    const editedRow = page.locator('.task-list li', { hasText: 'Comprar café en grano' });
    await editedRow.locator('input[type=checkbox]').click();
    await expect(editedRow).toHaveClass(/done/);

    // eliminar
    await editedRow.locator('.delete').click();
    await expect(page.locator('.empty')).toBeVisible();
  });

  test('filtra por texto y por estado', async ({ page }) => {
    await registerNewOrg(page);
    await goToTasks(page);

    for (const title of ['Pagar alquiler', 'Revisar PR', 'Pagar internet']) {
      await page.fill('input[formcontrolname="title"]', title);
      await page.click('.add-form button[type=submit]');
      await expect(page.locator('.task-list li', { hasText: title })).toBeVisible();
    }

    await page.fill('input[formcontrolname="q"]', 'Pagar');
    await expect(page.locator('.task-list li')).toHaveCount(2);

    await page.fill('input[formcontrolname="q"]', '');
    await page.locator('.task-list li', { hasText: 'Revisar PR' }).locator('input[type=checkbox]').click();
    await page.waitForTimeout(200);

    await page.selectOption('select[formcontrolname="done"]', 'true');
    await expect(page.locator('.task-list li')).toHaveCount(1);
    await expect(page.locator('.task-list li')).toHaveText(/Revisar PR/);

    await page.selectOption('select[formcontrolname="done"]', 'false');
    await expect(page.locator('.task-list li')).toHaveCount(2);
  });

  test('pagina cuando hay más tareas que el tamaño de página', async ({ page }) => {
    await registerNewOrg(page);
    await goToTasks(page);

    for (let i = 1; i <= 6; i++) {
      await page.fill('input[formcontrolname="title"]', `Tarea ${i}`);
      await page.click('.add-form button[type=submit]');
      await page.waitForTimeout(100);
    }

    await expect(page.locator('.task-list li')).toHaveCount(5);
    await expect(page.locator('.pagination')).toContainText('Página 1 de 2');

    await page.click('.pagination button:has-text("Siguiente")');
    await expect(page.locator('.task-list li')).toHaveCount(1);
    await expect(page.locator('.pagination')).toContainText('Página 2 de 2');

    await page.click('.pagination button:has-text("Anterior")');
    await expect(page.locator('.task-list li')).toHaveCount(5);
  });
});
