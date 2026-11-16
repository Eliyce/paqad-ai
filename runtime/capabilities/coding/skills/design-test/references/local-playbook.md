# Local design playbook entries

verified: 2026-11-16

Example entries for the Step 2.5 playbook, one Playwright snippet per probe. They are templates written into `docs/design-test/<timestamp>-local-playbook.md`, never run automatically.

```ts
// contrast probe: assert text/bg pair meets WCAG-2.2-1.4.3 (4.5:1)
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('contrast on /pricing', async ({ page }) => {
  await page.goto('/pricing');
  const results = await new AxeBuilder({ page }).withTags(['wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
});

// focus-ring probe: keyboard reach must produce a visible focus outline
test('focus ring visible on primary button', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const outline = await page
    .locator(':focus-visible')
    .evaluate((el) => getComputedStyle(el).outlineWidth);
  expect(outline).not.toBe('0px');
});

// token-leak probe: computed color must resolve to a declared token
test('button bg = color.primary.500', async ({ page }) => {
  await page.goto('/');
  const bg = await page
    .locator('button.primary')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(26, 115, 232)'); // declared in tokens.md as color.primary.500
});
```
