import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeFeatureReview } from '@/feature-evidence/artifacts.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { ImplementationReviewGate } from '@/verification/gates/implementation-review.js';

import { writeFailingChecks, writeRuleReport } from '../own-change.fixture.js';
import { createVerificationContext } from '../shared.fixture.js';

describe('ImplementationReviewGate', () => {
  it('fails when implementation review fails', async () => {
    await expect(
      new ImplementationReviewGate().check(
        createVerificationContext({ implementation_review_passed: false }),
      ),
    ).resolves.toMatchObject({ passed: false });
  });

  it('fails on blocking decision-violation findings and passes warning-only undeclared findings', async () => {
    await expect(
      new ImplementationReviewGate().check(
        createVerificationContext({
          implementation_review_findings: [
            {
              kind: 'decision-violation',
              severity: 'error',
              detail:
                'decision-violation: changed a rejected path instead of src/components/Button.tsx',
              decision_id: 'D-4',
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({
      passed: false,
      detail: expect.stringContaining('decision-violation'),
    });

    await expect(
      new ImplementationReviewGate().check(
        createVerificationContext({
          implementation_review_findings: [
            {
              kind: 'undeclared-decision',
              severity: 'warning',
              detail: 'undeclared_decision: created src/components/ButtonV2.tsx',
              file: 'src/components/ButtonV2.tsx',
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({
      passed: true,
      detail: expect.stringContaining('passed with warnings'),
    });
  });
});

describe('ImplementationReviewGate · unaddressed machine findings', () => {
  const SES = 'ses_gate_digest';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function ruleFinding(root: string, severity: string, kind = 'deterministic'): void {
    mkdirSync(join(root, '.paqad/scripts/rules/.cache'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/scripts/rules/.cache/report.json'),
      JSON.stringify({
        results: [
          {
            rule_id: 'RL-6740',
            script: 'a.mjs',
            kind,
            findings: [{ file: 'src/x.ts', line: 12, message: 'docs disagree', severity }],
          },
        ],
      }),
    );
  }

  function recordReview(root: string, summary: string): void {
    vi.stubEnv('CLAUDE_SESSION_ID', SES);
    openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'Digest gate',
      issue: '360',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });
    writeFeatureReview(root, SES, {
      summary,
      verdict: 'safe-to-merge',
      rollback: 'Revert the commit.',
    });
  }

  it('fails naming the file:line the review never mentions (AC-2)', async () => {
    const context = createVerificationContext();
    ruleFinding(context.project_root, 'high');
    recordReview(context.project_root, 'Looks good to me.');

    await expect(new ImplementationReviewGate().check(context)).resolves.toMatchObject({
      passed: false,
      detail: expect.stringContaining('src/x.ts:12'),
    });
  });

  it('passes once the review cites that file:line (AC-2)', async () => {
    const context = createVerificationContext();
    ruleFinding(context.project_root, 'high');
    recordReview(
      context.project_root,
      'Contested src/x.ts:12 — the doc is right, the rule is stale.',
    );

    await expect(new ImplementationReviewGate().check(context)).resolves.toMatchObject({
      passed: true,
    });
  });

  it('fails when no review has been recorded at all — nothing was addressed', async () => {
    const context = createVerificationContext();
    ruleFinding(context.project_root, 'high');
    vi.stubEnv('CLAUDE_SESSION_ID', SES);

    await expect(new ImplementationReviewGate().check(context)).resolves.toMatchObject({
      passed: false,
      detail: expect.stringContaining('src/x.ts:12'),
    });
  });

  it('never fires on a medium-severity or heuristic finding (INV-2)', async () => {
    const medium = createVerificationContext();
    ruleFinding(medium.project_root, 'medium');
    recordReview(medium.project_root, 'Looks good to me.');
    await expect(new ImplementationReviewGate().check(medium)).resolves.toMatchObject({
      passed: true,
    });

    const heuristic = createVerificationContext();
    ruleFinding(heuristic.project_root, 'high', 'heuristic');
    recordReview(heuristic.project_root, 'Looks good to me.');
    await expect(new ImplementationReviewGate().check(heuristic)).resolves.toMatchObject({
      passed: true,
    });
  });

  it('behaves exactly as before when no machine findings are on record (AC-3)', async () => {
    const reviewed = createVerificationContext();
    recordReview(reviewed.project_root, 'Looks good to me.');
    await expect(new ImplementationReviewGate().check(reviewed)).resolves.toMatchObject({
      passed: true,
      detail: 'Implementation review passed',
    });

    await expect(
      new ImplementationReviewGate().check(
        createVerificationContext({ implementation_review_passed: false }),
      ),
    ).resolves.toMatchObject({ passed: false });
  });

  it('did not run when no review is on record, and is not required on a lane with no review stage', async () => {
    await expect(
      new ImplementationReviewGate().check(createVerificationContext()),
    ).resolves.toMatchObject({ outcome: 'did-not-run' });
    await expect(
      new ImplementationReviewGate().check(createVerificationContext({ lane: 'fast' })),
    ).resolves.toMatchObject({ outcome: 'not-required' });
  });

  it('keeps the decision-violation failure ahead of the anchoring check', async () => {
    const context = createVerificationContext({
      implementation_review_findings: [
        {
          kind: 'decision-violation',
          severity: 'error',
          detail: 'decision-violation: landed against D-1',
          decision_id: 'D-1',
        },
      ],
    });
    ruleFinding(context.project_root, 'high');

    await expect(new ImplementationReviewGate().check(context)).resolves.toMatchObject({
      passed: false,
      detail: expect.stringContaining('decision-violation'),
    });
  });

  it('still reports warnings when the machine findings are all addressed', async () => {
    const context = createVerificationContext({
      implementation_review_findings: [
        {
          kind: 'undeclared-decision',
          severity: 'warning',
          detail: 'undeclared_decision: created src/components/ButtonV2.tsx',
          file: 'src/components/ButtonV2.tsx',
        },
      ],
    });
    ruleFinding(context.project_root, 'high');
    recordReview(context.project_root, 'Confirmed src/x.ts:12 and fixed it.');

    await expect(new ImplementationReviewGate().check(context)).resolves.toMatchObject({
      passed: true,
      detail: expect.stringContaining('passed with warnings'),
    });
  });
});

describe('ImplementationReviewGate on the change own files', () => {
  function withRuleFinding(file: string, ownFiles: string[] | null | undefined) {
    const context = createVerificationContext({
      ...(ownFiles === undefined ? {} : { change_own_files: ownFiles }),
    });
    writeRuleReport(context.project_root, file);
    return context;
  }

  it('AC-4: an empty known set reads not required, naming why, with a stale row on disk', async () => {
    const result = await new ImplementationReviewGate().check(withRuleFinding('a.ts', []));
    expect(result.outcome).toBe('not-required');
    expect(result.detail).toBe('no files changed in this change yet');
  });

  it('INV-5: an empty set past specification falls through to the filter', async () => {
    const context = createVerificationContext({
      change_own_files: [],
      change_past_specification: true,
    });
    writeFailingChecks(context.project_root, 'tests/a.test.ts');
    const result = await new ImplementationReviewGate().check(context);
    expect(result.outcome).not.toBe('not-required');
    expect(result.detail).toContain('tests/a.test.ts:4');
  });

  it('AC-4: a blocking finding still fails an empty change', async () => {
    const result = await new ImplementationReviewGate().check(
      createVerificationContext({
        change_own_files: [],
        implementation_review_findings: [
          { kind: 'decision-violation', severity: 'error', detail: 'open defect', evidence: [] },
        ],
      }),
    );
    expect(result.passed).toBe(false);
  });

  it('AC-5: a finding on a.ts is ignored when the change only changed b.ts', async () => {
    const result = await new ImplementationReviewGate().check(withRuleFinding('a.ts', ['b.ts']));
    expect(result.detail).not.toContain('a.ts');
    expect(result.detail).not.toContain('machine finding');
  });

  it('AC-19: a finding on b.ts still fails when the change changed b.ts', async () => {
    const result = await new ImplementationReviewGate().check(withRuleFinding('b.ts', ['b.ts']));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('b.ts:3');
  });

  it.each([null, undefined])('AC-19: an unknown set keeps the finding (%s)', async (own) => {
    const result = await new ImplementationReviewGate().check(withRuleFinding('a.ts', own));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('a.ts:3');
  });

  it('AC-20: an absolute finding path on a changed file still fails', async () => {
    const context = createVerificationContext({ change_own_files: ['b.ts'] });
    writeRuleReport(context.project_root, join(context.project_root, 'b.ts'));
    const result = await new ImplementationReviewGate().check(context);
    expect(result.passed).toBe(false);
  });

  it('AC-22: a checks failure in an untouched file stays a citation requirement', async () => {
    const context = createVerificationContext({ change_own_files: ['b.ts'] });
    writeFailingChecks(context.project_root, 'tests/a.test.ts');
    const result = await new ImplementationReviewGate().check(context);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('tests/a.test.ts:4');
  });
});
