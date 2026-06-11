import { describe, expect, it } from 'vitest';

import { VERIFICATION_GATES } from '@/core/types/verification.js';
import type { GateResult } from '@/core/types/verification.js';
import { GATE_STRENGTH_TIER, gradeGateResult } from '@/evidence/grading.js';

function gate(overrides: Partial<GateResult> & Pick<GateResult, 'gate'>): GateResult {
  return { passed: true, detail: 'ok', ...overrides };
}

describe('GATE_STRENGTH_TIER', () => {
  it('classifies every one of the 16 gates exactly once', () => {
    for (const g of VERIFICATION_GATES) {
      expect(GATE_STRENGTH_TIER[g]).toMatch(/^(deterministic|llm-judged)$/);
    }
    expect(Object.keys(GATE_STRENGTH_TIER).sort()).toEqual([...VERIFICATION_GATES].sort());
  });

  it('keeps the four LLM-judged gates separate from the deterministic ones', () => {
    expect(GATE_STRENGTH_TIER['spec-review']).toBe('llm-judged');
    expect(GATE_STRENGTH_TIER['implementation-review']).toBe('llm-judged');
    expect(GATE_STRENGTH_TIER['story-quality']).toBe('llm-judged');
    expect(GATE_STRENGTH_TIER['requirement-completeness']).toBe('llm-judged');
    expect(GATE_STRENGTH_TIER['mutation-testing']).toBe('deterministic');
    expect(GATE_STRENGTH_TIER['quality-ratchet']).toBe('deterministic');
    expect(GATE_STRENGTH_TIER['ac-test-mapping']).toBe('deterministic');
  });
});

describe('gradeGateResult', () => {
  it('grades a deterministic pass as deterministic/pass', () => {
    expect(gradeGateResult(gate({ gate: 'mutation-testing', passed: true }))).toEqual({
      verdict: 'pass',
      strength_class: 'deterministic',
    });
  });

  it('keeps a failed deterministic gate deterministic (strength is how, not pass/fail)', () => {
    expect(gradeGateResult(gate({ gate: 'mutation-testing', passed: false }))).toEqual({
      verdict: 'fail',
      strength_class: 'deterministic',
    });
  });

  it('grades an LLM-judged pass as llm-judged/pass', () => {
    expect(gradeGateResult(gate({ gate: 'spec-review', passed: true }))).toEqual({
      verdict: 'pass',
      strength_class: 'llm-judged',
    });
  });

  it('grades any inconclusive gate as Tier C (blocked) regardless of its tier', () => {
    expect(
      gradeGateResult(gate({ gate: 'mutation-testing', passed: false, inconclusive: true })),
    ).toEqual({ verdict: 'inconclusive', strength_class: 'blocked' });
  });
});
