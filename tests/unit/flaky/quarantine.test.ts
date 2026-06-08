import { describe, expect, it } from 'vitest';

import { FLAKY_REGISTRY_SCHEMA_VERSION, type FlakyRegistry } from '@/core/types/flaky.js';
import type { VerificationEvidenceFailure } from '@/core/types/verification-evidence.js';
import { applyQuarantine, passesBlockingGate } from '@/flaky/quarantine.js';
import { upsertQuarantine } from '@/flaky/registry.js';

const NOW = '2026-06-08T00:00:00.000Z';

function failure(testId: string, suite: string | null): VerificationEvidenceFailure {
  return {
    category: 'test-failure',
    file: 'tests/x.test.ts',
    line: 1,
    test_id: testId,
    suite,
    ac_id: null,
    message: 'boom',
    stderr_excerpt: null,
  };
}

function registryWith(testId: string, suite: string | null): FlakyRegistry {
  const empty: FlakyRegistry = {
    schema_version: FLAKY_REGISTRY_SCHEMA_VERSION,
    updated_at: NOW,
    entries: [],
  };
  return upsertQuarantine(empty, {
    test_id: testId,
    suite,
    reruns: 4,
    passes: 2,
    failures: 2,
    suspected_causes: ['timing'],
    modules: ['cli-rag'],
    now: NOW,
  });
}

describe('applyQuarantine', () => {
  it('moves a quarantined failure out of the blocking set (still tracked, not deleted)', () => {
    const registry = registryWith('flaky-test', 'suite');
    const app = applyQuarantine(
      [failure('flaky-test', 'suite'), failure('real-test', 'suite')],
      registry,
    );
    expect(app.blocking.map((f) => f.test_id)).toEqual(['real-test']);
    expect(app.quarantined.map((f) => f.test_id)).toEqual(['flaky-test']);
    expect(app.quarantined[0].quarantined).toBe(true);
    expect(app.quarantined[0].flaky).toBe(true);
    expect(app.active_quarantines).toEqual(['suite::flaky-test']);
  });

  it('still blocks on the non-quarantined (real) failure', () => {
    const registry = registryWith('flaky-test', 'suite');
    const app = applyQuarantine(
      [failure('flaky-test', 'suite'), failure('real-test', 'suite')],
      registry,
    );
    expect(passesBlockingGate(app)).toBe(false);
  });

  it('green is meaningful only when no active quarantine exists', () => {
    const empty: FlakyRegistry = {
      schema_version: FLAKY_REGISTRY_SCHEMA_VERSION,
      updated_at: NOW,
      entries: [],
    };
    expect(applyQuarantine([], empty).meaningful_green).toBe(true);

    const registry = registryWith('flaky-test', 'suite');
    const app = applyQuarantine([], registry);
    // No blocking failures, but a quarantine is in play → green is NOT meaningful.
    expect(passesBlockingGate(app)).toBe(true);
    expect(app.meaningful_green).toBe(false);
  });

  it('does not quarantine a failure that lacks a test_id', () => {
    const registry = registryWith('flaky-test', 'suite');
    const noId = { ...failure('x', 'suite'), test_id: null };
    const app = applyQuarantine([noId], registry);
    expect(app.blocking).toHaveLength(1);
    expect(app.quarantined).toHaveLength(0);
  });
});
