import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import { FLAKY_REGISTRY_SCHEMA_VERSION, type FlakyRegistry } from '@/core/types/flaky.js';
import { modulesForFile, modulesForFiles, quarantineCountsByModule } from '@/flaky/attribution.js';
import { upsertQuarantine } from '@/flaky/registry.js';

const NOW = '2026-06-08T00:00:00.000Z';

function writeModuleMap(projectRoot: string): void {
  const path = join(projectRoot, PATHS.MODULE_MAP);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    YAML.stringify({
      modules: [
        { slug: 'payments', name: 'Payments', sources: ['src/payments/**'] },
        { slug: 'billing', name: 'Billing', sources: ['src/billing/**'] },
      ],
    }),
  );
}

describe('module attribution (reuses module-map machinery)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-flaky-attr-'));
    writeModuleMap(projectRoot);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('maps a file to its owning module slug', () => {
    expect(modulesForFile(projectRoot, 'src/payments/checkout.ts')).toEqual(['payments']);
  });

  it('returns no modules for an unmapped file or null path', () => {
    expect(modulesForFile(projectRoot, 'src/unknown/x.ts')).toEqual([]);
    expect(modulesForFile(projectRoot, null)).toEqual([]);
  });

  it('returns the distinct sorted modules touched by a set of files', () => {
    expect(
      modulesForFiles(projectRoot, ['src/payments/a.ts', 'src/billing/b.ts', 'src/payments/c.ts']),
    ).toEqual(['billing', 'payments']);
  });

  it('returns no modules when there is no module map', () => {
    const bare = mkdtempSync(join(tmpdir(), 'paqad-flaky-nomap-'));
    expect(modulesForFile(bare, 'src/payments/x.ts')).toEqual([]);
    expect(modulesForFiles(bare, ['src/payments/x.ts'])).toEqual([]);
    rmSync(bare, { recursive: true, force: true });
  });
});

describe('quarantineCountsByModule', () => {
  it('rolls active quarantines into per-module counts, sorted, omitting zeros', () => {
    let registry: FlakyRegistry = {
      schema_version: FLAKY_REGISTRY_SCHEMA_VERSION,
      updated_at: NOW,
      entries: [],
    };
    registry = upsertQuarantine(registry, {
      test_id: 't1',
      suite: null,
      reruns: 4,
      passes: 2,
      failures: 2,
      suspected_causes: [],
      modules: ['payments'],
      now: NOW,
    });
    registry = upsertQuarantine(registry, {
      test_id: 't2',
      suite: null,
      reruns: 4,
      passes: 2,
      failures: 2,
      suspected_causes: [],
      modules: ['payments', 'billing'],
      now: NOW,
    });
    expect(quarantineCountsByModule(registry)).toEqual([
      { module: 'billing', quarantined: 1 },
      { module: 'payments', quarantined: 2 },
    ]);
  });
});
