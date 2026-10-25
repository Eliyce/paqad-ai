import { rmSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import type { VerificationContext } from '@/core/types/verification.js';
import { gateResultsToRows } from '@/evidence/fan-in.js';
import { gateStateOf } from '@/evidence/grading.js';
import { buildVerificationEvidence } from '@/verification/evidence.js';
import { ArchitectureComplianceGate } from '@/verification/gates/architecture-compliance.js';
import { BehavioralCorrectnessGate } from '@/verification/gates/behavioral-correctness.js';
import { ChangeCompletenessGate } from '@/verification/gates/change-completeness.js';
import { CodeTestsLintGate } from '@/verification/gates/code-tests-lint.js';
import { DatabaseQualityGate } from '@/verification/gates/database-quality.js';
import type { Gate } from '@/verification/gates/gate.interface.js';
import { RequirementCompletenessGate } from '@/verification/gates/requirement-completeness.js';
import { SpecReviewGate } from '@/verification/gates/spec-review.js';
import { StoryQualityGate } from '@/verification/gates/story-quality.js';
import {
  buildRepositoryVerificationVerdict,
  receiptGateWord,
} from '@/verification/repository/verdict.js';
import { verdictKindFor } from '@/verification/verdict-kind.js';

import { createVerificationContext } from '../shared.fixture.js';

const roots: string[] = [];

function context(
  overrides: Partial<VerificationContext> = {},
  without: readonly (keyof VerificationContext)[] = [],
): VerificationContext {
  const ctx = createVerificationContext(overrides);
  roots.push(ctx.project_root);
  for (const key of without) delete ctx[key];
  return ctx;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('AC-28: an input that was forced true on main is not a pass when its evidence is absent', () => {
  const CASES: Array<[keyof VerificationContext, Gate]> = [
    ['requirements_complete', new RequirementCompletenessGate()],
    ['story_quality_passed', new StoryQualityGate()],
    ['architecture_compliant', new ArchitectureComplianceGate()],
    ['database_quality_passed', new DatabaseQualityGate()],
    ['behavioral_correctness_passed', new BehavioralCorrectnessGate()],
    ['code_tests_lint_passed', new CodeTestsLintGate()],
  ];

  it.each(CASES)('AC-28: with no %s the gate did not run', async (input, gate) => {
    const result = await gate.check(
      context({ code_changed: false, structured_test_results: undefined }, [input]),
    );
    expect(gateStateOf(result)).toBe('did-not-run');
    expect(result.outcome).toBe('did-not-run');
  });

  it('AC-28: change-completeness reads an absent input as unknown, not as a failure', async () => {
    const result = await new ChangeCompletenessGate().check(
      context({ code_changed: false, structured_test_results: undefined }, [
        'requirements_complete',
        'story_quality_passed',
        'architecture_compliant',
        'database_quality_passed',
        'behavioral_correctness_passed',
        'code_tests_lint_passed',
      ]),
    );
    expect(result.detail).not.toMatch(/incomplete|failed/i);
    expect(result.passed).toBe(true);
  });
});

describe('AC-6: spec-review with no spec is could not prove, never pass', () => {
  it('AC-6: on a full lane with nothing proving the review the row is could not prove', async () => {
    const result = await new SpecReviewGate().check(
      context({
        lane: 'full',
        spec_review_passed: true,
        spec_review_inconclusive: true,
        spec_review_detail: 'Code changed but no frozen spec or spec-review report was found.',
      }),
    );
    expect(gateStateOf(result)).toBe('inconclusive');
    const [row] = gateResultsToRows([result], { subjectDigest: 'd', ts: 't' });
    expect(row?.verdict).toBe('inconclusive');

    const evidence = buildVerificationEvidence({
      results: [result],
      context: {},
      run_id: 'r',
      started_at: 't',
      completed_at: 't',
    });
    const verdict = buildRepositoryVerificationVerdict({
      origin: 'hook-completion',
      evidence,
      escalations: [],
      evidencePath: null,
    });
    const gate = verdict.gates.find((entry) => entry.gate === 'spec-review')!;
    expect(gate.status).toBe('pass');
    expect(receiptGateWord(gate)).toBe('Could not prove');
    expect(verdict.summary).toContain('spec-review: could not prove');
    expect(verdict.summary).not.toContain('1/1 checks held');
    expect(verdictKindFor(verdict.gates)).toBe('pass');
  });

  it('AC-6: on a lane with no specification stage spec-review is not required', async () => {
    const result = await new SpecReviewGate().check(
      context({ lane: 'fast', spec_review_passed: true, spec_review_inconclusive: true }),
    );
    expect(gateStateOf(result)).toBe('not-required');
  });

  it('AC-6: an on-record spec review with an open critical defect still fails on the fast lane', async () => {
    const result = await new SpecReviewGate().check(
      context({ lane: 'fast', spec_review_passed: false, spec_review_on_record: true }),
    );
    expect(gateStateOf(result)).toBe('fail');
  });

  it('AC-6: an on-record clean spec review passes on the fast lane', async () => {
    const result = await new SpecReviewGate().check(
      context({ lane: 'fast', spec_review_passed: true, spec_review_on_record: true }),
    );
    expect(gateStateOf(result)).toBe('pass');
  });

  it('AC-6: a proven review still passes', async () => {
    const result = await new SpecReviewGate().check(
      context({ lane: 'full', spec_review_passed: true }),
    );
    expect(gateStateOf(result)).toBe('pass');
  });
});
