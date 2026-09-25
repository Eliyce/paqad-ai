import { describe, expect, it } from 'vitest';

import { buildProvenance, decideFinish, frozenPipelineSection } from '@/spec-pipeline/finish.js';
import type { PipelineConfig } from '@/spec-pipeline/config.js';
import type { ExpertRunAccounting } from '@/spec-pipeline/experts/types.js';

const cfg = (over: Partial<PipelineConfig> = {}): PipelineConfig => ({
  enabled: true,
  clarification: 'warn',
  final_review: 'off',
  token_ceiling: 20000,
  experts_enabled: false,
  ...over,
});

describe('decideFinish', () => {
  it('freezes automatically when A5 is live and final-review is off (FR-7.1)', () => {
    expect(decideFinish(cfg(), true).outcome).toBe('freeze');
  });

  it('shows a non-blocking review when A5 is not live (FR-7.2 / EC-13)', () => {
    expect(decideFinish(cfg(), false).outcome).toBe('non-blocking-review');
  });

  it('awaits a human when final-review is required, even with A5 live (FR-7.3)', () => {
    expect(decideFinish(cfg({ final_review: 'strict' }), true).outcome).toBe(
      'await-human-approval',
    );
  });

  it('advisory final-review shows then freezes when A5 is live', () => {
    expect(decideFinish(cfg({ final_review: 'warn' }), true).outcome).toBe('freeze');
  });
});

describe('buildProvenance', () => {
  it('records pipeline-produced, answer refs, counts, enforcement, a5 flag; no fake signoff (FR-7.4)', () => {
    const prov = buildProvenance(cfg(), true, ['D-1', 'D-2'], {
      asked: 3,
      answered: 2,
      auto_answered: 1,
      deferred: 0,
    });
    expect(prov.pipeline_produced).toBe(true);
    expect(prov.answer_refs).toEqual(['D-1', 'D-2']);
    expect(prov.a5_live).toBe(true);
    expect(prov.outcome).toBe('freeze');
    expect(prov.enforcement.enabled).toBe(true);
    // No `signed_off_by` / signature field is ever present.
    expect('signed_off_by' in prov).toBe(false);
  });

  it('omits the experts block entirely when no experts ran — byte-identical to v1 (INV-1/AC-7)', () => {
    const prov = buildProvenance(cfg(), true, [], {
      asked: 0,
      answered: 0,
      auto_answered: 0,
      deferred: 0,
    });
    expect('experts' in prov).toBe(false);
  });

  it('folds the experts block in only when experts ran (issue #521, FR-8)', () => {
    const accounting: ExpertRunAccounting = {
      experts: [{ role: 'db-expert', reason: 'migration', tokens: 900, changed_spec: true }],
      total_tokens: 900,
      warnings: [],
    };
    const prov = buildProvenance(
      cfg({ experts_enabled: true }),
      true,
      [],
      { asked: 0, answered: 0, auto_answered: 0, deferred: 0 },
      { accounting, conflicts: [] },
    );
    expect(prov.experts?.accounting.total_tokens).toBe(900);
    expect(prov.experts?.conflicts).toEqual([]);
  });
});

// Issue #547 — buildProvenance folds the metrics in only when given (FR-11.1).
describe('buildProvenance metrics', () => {
  const metrics = {
    grounding_sparse: false,
    grounding_path: 'docs-fallback' as const,
    label: 'clear' as const,
    signal_count: 0,
    questions: { asked: 0, answered: 0, auto_answered: 0, deferred: 0 },
    expert_count: 0,
    spec_words: 10,
    tokens_by_step: {},
    tiers_by_step: {},
    ceiling_warnings: [],
    a5_live: true,
    a5_verdict: 'live',
    freeze_checks_fired: [],
  };

  it('includes metrics when provided', () => {
    const p = buildProvenance(
      cfg(),
      true,
      [],
      { asked: 0, answered: 0, auto_answered: 0, deferred: 0 },
      undefined,
      metrics,
    );
    expect(p.metrics).toBe(metrics);
  });

  it('omits the metrics key when not provided (unchanged record)', () => {
    const p = buildProvenance(cfg(), true, [], {
      asked: 0,
      answered: 0,
      auto_answered: 0,
      deferred: 0,
    });
    expect('metrics' in p).toBe(false);
  });
});

// Issue #581 — the frozen `pipeline` section is shaped from the staged finish (D4).
describe('frozenPipelineSection', () => {
  it('stores the enforcement once, without the master switch', () => {
    const config: PipelineConfig = {
      enabled: true,
      clarification: 'warn',
      final_review: 'off',
      token_ceiling: 1000,
      experts_enabled: false,
      adoption: 'warn',
    };
    const provenance = buildProvenance(config, true, [], {
      asked: 0,
      answered: 0,
      auto_answered: 0,
      deferred: 0,
    });
    expect(frozenPipelineSection({ outcome: 'freeze', reason: 'live', provenance })).toEqual({
      produced: true,
      outcome: 'freeze',
      reason: 'live',
      a5_live: true,
      enforcement: {
        clarification: 'warn',
        final_review: 'off',
        token_ceiling: 1000,
        experts_enabled: false,
        adoption: 'warn',
      },
    });
  });

  it('leaves off every field the staged finish does not carry', () => {
    expect(frozenPipelineSection({ provenance: {} })).toEqual({ produced: true });
    expect(frozenPipelineSection({ provenance: { outcome: 'freeze' } })).toEqual({
      produced: true,
      outcome: 'freeze',
    });
  });
});
