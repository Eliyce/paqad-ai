import { describe, expect, it } from 'vitest';

import {
  FLAKY_REGISTRY_SCHEMA_VERSION,
  type FlakyRegistry,
  type StabilityJudgement,
} from '@/core/types/flaky.js';
import { clearQuarantineWithEvidence } from '@/flaky/clear.js';
import { upsertQuarantine } from '@/flaky/registry.js';

const NOW = '2026-06-08T00:00:00.000Z';
const LATER = '2026-06-09T00:00:00.000Z';

function quarantined(): FlakyRegistry {
  const empty: FlakyRegistry = {
    schema_version: FLAKY_REGISTRY_SCHEMA_VERSION,
    updated_at: NOW,
    entries: [],
  };
  return upsertQuarantine(empty, {
    test_id: 't',
    suite: 's',
    reruns: 4,
    passes: 2,
    failures: 2,
    suspected_causes: ['timing'],
    modules: ['cli-rag'],
    now: NOW,
  });
}

function judgement(over: Partial<StabilityJudgement>): StabilityJudgement {
  return { test_id: 't', verdict: 'recovered', reruns: 5, passes: 5, failures: 0, ...over };
}

describe('clearQuarantineWithEvidence — empirical, not claimed', () => {
  it('clears when post-fix re-runs all pass (recovered)', () => {
    const result = clearQuarantineWithEvidence({
      registry: quarantined(),
      test_id: 't',
      suite: 's',
      judgement: judgement({}),
      now: LATER,
    });
    expect(result.cleared).toBe(true);
    expect(result.registry.entries[0].status).toBe('cleared');
    expect(result.reason).toContain('empirical-stability');
  });

  it('refuses to clear when the test still flips (still flaky)', () => {
    const result = clearQuarantineWithEvidence({
      registry: quarantined(),
      test_id: 't',
      suite: 's',
      judgement: judgement({ verdict: 'flaky', passes: 3, failures: 2 }),
      now: LATER,
    });
    expect(result.cleared).toBe(false);
    expect(result.reason).toContain('still-flaky');
    expect(result.registry.entries[0].status).toBe('quarantined');
  });

  it('refuses to clear when the test still fails outright', () => {
    const result = clearQuarantineWithEvidence({
      registry: quarantined(),
      test_id: 't',
      suite: 's',
      judgement: judgement({ verdict: 'real', passes: 0, failures: 5 }),
      now: LATER,
    });
    expect(result.cleared).toBe(false);
    expect(result.reason).toContain('still-failing');
  });
});
