import { describe, expect, it } from 'vitest';

import { buildProvenance, decideFinish } from '@/spec-pipeline/finish.js';
import type { PipelineConfig } from '@/spec-pipeline/config.js';

const cfg = (over: Partial<PipelineConfig> = {}): PipelineConfig => ({
  enabled: true,
  clarification: 'warn',
  final_review: 'off',
  token_ceiling: 20000,
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
    expect(decideFinish(cfg({ final_review: 'strict' }), true).outcome).toBe('await-human-approval');
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
});
