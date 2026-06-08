import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import { FLAKY_REGISTRY_SCHEMA_VERSION, type FlakyRegistry } from '@/core/types/flaky.js';
import { upsertQuarantine } from '@/flaky/registry.js';
import { evaluateTouchGate } from '@/flaky/touch-gate.js';

const NOW = '2026-06-08T00:00:00.000Z';

function setup(projectRoot: string): void {
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

function registryWithPaymentsFlake(): FlakyRegistry {
  const empty: FlakyRegistry = {
    schema_version: FLAKY_REGISTRY_SCHEMA_VERSION,
    updated_at: NOW,
    entries: [],
  };
  return upsertQuarantine(empty, {
    test_id: 'payments flake',
    suite: null,
    reruns: 4,
    passes: 2,
    failures: 2,
    suspected_causes: ['timing'],
    modules: ['payments'],
    now: NOW,
  });
}

describe('evaluateTouchGate — forced-fix-on-touch', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-flaky-gate-'));
    setup(projectRoot);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('forces the fix when a graduated/full change touches a module that owns a quarantined test', () => {
    const result = evaluateTouchGate({
      projectRoot,
      registry: registryWithPaymentsFlake(),
      changedFiles: ['src/payments/refund.ts'],
      lane: 'full',
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('forced-fix');
    expect(result.touched_modules).toEqual(['payments']);
    expect(result.debts).toHaveLength(1);
    expect(result.debts[0].test_id).toBe('payments flake');
    expect(result.debts[0].suspected_causes).toEqual(['timing']);
  });

  it('does not block a change that touches an unrelated module', () => {
    const result = evaluateTouchGate({
      projectRoot,
      registry: registryWithPaymentsFlake(),
      changedFiles: ['src/billing/invoice.ts'],
      lane: 'graduated',
    });
    expect(result.blocked).toBe(false);
    expect(result.reason).toBe('no-debt');
    expect(result.touched_modules).toEqual(['billing']);
  });

  it('never blocks a fast-lane change (cheap detection still runs, forced-fix does not)', () => {
    const result = evaluateTouchGate({
      projectRoot,
      registry: registryWithPaymentsFlake(),
      changedFiles: ['src/payments/refund.ts'],
      lane: 'fast',
    });
    expect(result.blocked).toBe(false);
    expect(result.reason).toBe('fast-lane-skipped');
  });

  it('reports no-debt when the change touches no mapped module', () => {
    const result = evaluateTouchGate({
      projectRoot,
      registry: registryWithPaymentsFlake(),
      changedFiles: ['README.md'],
      lane: 'full',
    });
    expect(result.blocked).toBe(false);
    expect(result.reason).toBe('no-debt');
    expect(result.touched_modules).toEqual([]);
  });
});
