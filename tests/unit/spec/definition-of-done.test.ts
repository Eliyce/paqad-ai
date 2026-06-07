import { describe, expect, it } from 'vitest';

import type { DoneInput } from '@/core/types/feature-spec.js';
import { isDone, renderDefinitionOfDone } from '@/spec/definition-of-done.js';

function baseInput(overrides: Partial<DoneInput> = {}): DoneInput {
  return {
    gates_passed: true,
    acceptance_criteria: [
      { criterion_id: 'AC-1', proof_passing: true },
      { criterion_id: 'AC-2', proof_passing: true },
    ],
    findings: [],
    ...overrides,
  };
}

describe('isDone', () => {
  it('is done when gates pass, every AC proves, and no confirmed blocking finding exists', () => {
    expect(isDone(baseInput())).toEqual({
      done: true,
      gates_passed: true,
      failing_criteria: [],
      blocking_findings: [],
    });
  });

  it('is not done when verification gates fail', () => {
    expect(isDone(baseInput({ gates_passed: false })).done).toBe(false);
  });

  it('names the one failing acceptance criterion', () => {
    const result = isDone(
      baseInput({
        acceptance_criteria: [
          { criterion_id: 'AC-1', proof_passing: true },
          { criterion_id: 'AC-2', proof_passing: false },
        ],
      }),
    );
    expect(result.done).toBe(false);
    expect(result.failing_criteria).toEqual(['AC-2']);
  });

  it('never flips to false on a taste finding, even a confirmed one', () => {
    const result = isDone(baseInput({ findings: [{ id: 'F-1', kind: 'taste', confirmed: true }] }));
    expect(result.done).toBe(true);
    expect(result.blocking_findings).toEqual([]);
  });

  it('blocks on a confirmed non-taste finding but not an unconfirmed one', () => {
    expect(
      isDone(baseInput({ findings: [{ id: 'F-2', kind: 'correctness', confirmed: false }] })).done,
    ).toBe(true);
    const blocked = isDone(
      baseInput({ findings: [{ id: 'F-3', kind: 'correctness', confirmed: true }] }),
    );
    expect(blocked.done).toBe(false);
    expect(blocked.blocking_findings).toEqual(['F-3']);
  });

  it('is never done with no acceptance criteria to prove', () => {
    expect(isDone(baseInput({ acceptance_criteria: [] })).done).toBe(false);
  });
});

describe('renderDefinitionOfDone', () => {
  it('renders a DONE checklist with all marks passing', () => {
    const rendered = renderDefinitionOfDone(baseInput());
    expect(rendered).toContain('Result: DONE');
    expect(rendered).toContain('[✓] Verification gates pass');
    expect(rendered).toContain('Every acceptance criterion implemented and proven (2/2)');
  });

  it('names the failing AC and blocking finding on a NOT DONE checklist', () => {
    const rendered = renderDefinitionOfDone(
      baseInput({
        gates_passed: false,
        acceptance_criteria: [{ criterion_id: 'AC-2', proof_passing: false }],
        findings: [{ id: 'F-9', kind: 'security', confirmed: true }],
      }),
    );
    expect(rendered).toContain('Result: NOT DONE');
    expect(rendered).toContain('[✗] Verification gates pass');
    expect(rendered).toContain('Failing acceptance criteria: AC-2.');
    expect(rendered).toContain('Blocking findings: F-9.');
  });

  it('explains the empty acceptance-criteria case', () => {
    const rendered = renderDefinitionOfDone(baseInput({ acceptance_criteria: [] }));
    expect(rendered).toContain('Blocked: no acceptance criteria to prove.');
  });
});
