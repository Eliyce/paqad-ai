import { describe, expect, it } from 'vitest';

import { isDecisionPacket, validateDecisionPacket } from '@/planning/decision-packet.js';
import {
  decisionOptionsForCategory,
  decisionQuestionForCategory,
} from '@/planning/decision-packet-builder.js';
import { defaultSimilarityFor } from '@/planning/decision-evidence.js';
import { buildSpecChangePacket, buildSpecContradictionPacket } from '@/spec/spec-decisions.js';

const INPUT = {
  decision_id: 'D-1',
  spec_id: 'S-102',
  spec_file: '.paqad/specs/S-102.md',
  detail: 'The export format changed from CSV to XLSX.',
  task_session_id: 'sess-1',
  created_at: '2026-06-07T00:00:00Z',
};

describe('buildSpecChangePacket', () => {
  it('produces a valid spec.change packet that recommends updating and re-freezing', () => {
    const packet = buildSpecChangePacket(INPUT);
    expect(validateDecisionPacket(packet)).toEqual([]);
    expect(isDecisionPacket(packet)).toBe(true);
    expect(packet.category).toBe('spec.change');
    expect(packet.recommendation).toBe('update-and-refreeze');
    expect(packet.invalidation_watch).toEqual(['.paqad/specs/S-102.md']);
    // ttl_days for spec.change is 30
    expect(packet.ttl_until).toBe('2026-07-07T00:00:00.000Z');
  });
});

describe('buildSpecContradictionPacket', () => {
  it('offers fix-code / change-spec with no recommendation (never auto-resolved)', () => {
    const packet = buildSpecContradictionPacket(INPUT);
    expect(validateDecisionPacket(packet)).toEqual([]);
    expect(packet.category).toBe('spec.contradiction');
    expect(packet.recommendation).toBeUndefined();
    expect(packet.options.map((option) => option.option_key)).toEqual(['fix-code', 'change-spec']);
  });

  it('derives a stable fingerprint from category + spec + detail', () => {
    const a = buildSpecContradictionPacket(INPUT);
    const b = buildSpecContradictionPacket(INPUT);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('honours an explicit requested_by', () => {
    expect(buildSpecContradictionPacket({ ...INPUT, requested_by: 'me' }).requested_by).toBe('me');
  });
});

describe('decision category wiring for spec lifecycle', () => {
  it('has questions for the new categories', () => {
    expect(decisionQuestionForCategory('spec.change')).toContain('update the frozen spec');
    expect(decisionQuestionForCategory('spec.contradiction')).toContain('fix the code');
  });

  it('returns no file-evidence options (packets are built directly)', () => {
    expect(decisionOptionsForCategory('/root', 'spec.change', 'x.ts').options).toEqual([]);
    expect(decisionOptionsForCategory('/root', 'spec.contradiction', 'x.ts').options).toEqual([]);
  });

  it('returns a neutral default similarity for the new categories', () => {
    expect(defaultSimilarityFor('spec.change', true, 0)).toBe(0.5);
    expect(defaultSimilarityFor('spec.contradiction', true, 0)).toBe(0.5);
  });
});
