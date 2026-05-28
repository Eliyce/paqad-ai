import { test, expect } from '@playwright/test';

test.describe('Button', () => {
  test('renders default', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button')).toBeVisible();
  });

  test('shows hover state', async ({ page }) => {
    await page.goto('/');
    await page.locator('button').hover();
  });

  test('focuses on Tab', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
  });

  test('disabled prop renders disabled', async ({ page }) => {
    await page.goto('/?disabled=true');
    await expect(page.locator('button')).toBeDisabled();
  });
});
