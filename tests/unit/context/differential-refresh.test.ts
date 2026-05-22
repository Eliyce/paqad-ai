import { describe, expect, it } from 'vitest';

import { DifferentialRefresh } from '@/context/differential-refresh.js';

describe('DifferentialRefresh', () => {
  const refresh = new DifferentialRefresh();

  it('controller change refreshes only api registry', async () => {
    await expect(
      refresh.refresh(['app/Http/Controllers/UserController.php']),
    ).resolves.toMatchObject({
      refreshed: 1,
      registries: ['api-registry.md'],
    });
  });

  it('migration change refreshes table and query registries', async () => {
    await expect(
      refresh.refresh(['database/migrations/2026_01_01_create_users.php']),
    ).resolves.toMatchObject({
      refreshed: 2,
      registries: ['query-registry.md', 'table-registry.md'],
    });
  });

  it('component change refreshes component registry', async () => {
    await expect(refresh.refresh(['src/components/Button.tsx'])).resolves.toMatchObject({
      refreshed: 1,
      registries: ['component-registry.md'],
    });
  });

  it('no changes refreshes nothing', async () => {
    await expect(refresh.refresh([])).resolves.toMatchObject({
      refreshed: 0,
      registries: [],
    });
  });
});
