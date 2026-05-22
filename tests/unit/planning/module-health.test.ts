import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deriveHealthTier,
  initializeModuleHealth,
  readAllModuleHealth,
  readModuleHealth,
  writeModuleHealth,
} from '@/planning/module-health.js';

describe('module-health', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'planning-health-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('derives health tiers at the expected boundaries', () => {
    expect(
      deriveHealthTier({ coverage_pct: 80, defect_frequency: 2, contract_stability: 0.85 }),
    ).toBe('stable');
    expect(deriveHealthTier({ coverage_pct: 50, defect_frequency: 5 })).toBe('moderate');
    expect(deriveHealthTier({ coverage_pct: 10, defect_frequency: 9 })).toBe('fragile');
    expect(deriveHealthTier({})).toBe('unknown');
  });

  it('writes, reads, initializes, and lists module health files', async () => {
    await writeModuleHealth(root, 'planning', {
      coverage_pct: 81,
      defect_frequency: 2,
      contract_stability: 0.9,
    });

    await expect(readModuleHealth(root, 'planning')).resolves.toMatchObject({
      module: 'planning',
      tier: 'stable',
    });

    await expect(initializeModuleHealth(root, 'planning')).resolves.toMatchObject({
      module: 'planning',
      tier: 'stable',
    });

    await initializeModuleHealth(root, 'resolver');
    await expect(readAllModuleHealth(root)).resolves.toHaveLength(2);
  });

  it('returns empty collections when the module health directory is missing', async () => {
    await expect(readAllModuleHealth(join(root, 'missing'))).resolves.toEqual([]);
  });

  it('ignores non-profile json below module health when listing profiles', async () => {
    await initializeModuleHealth(root, 'planning');
    mkdirSync(join(root, '.paqad/module-health/evidence'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/module-health/evidence/event.json'),
      JSON.stringify({ schema_version: 1, event_id: 'mh-test' }),
    );

    await expect(readAllModuleHealth(root)).resolves.toHaveLength(1);
  });
});
