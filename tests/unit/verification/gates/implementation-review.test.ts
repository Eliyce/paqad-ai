import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeFeatureReview } from '@/feature-evidence/artifacts.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { ImplementationReviewGate } from '@/verification/gates/implementation-review.js';

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

// Issue #360 — the review must confirm or contest what the machine already proved. The
// gate re-derives the deterministic high-severity rows itself (D-01KY1TV1GFZ3CABQYWQR753XKT)
// rather than parsing the written digest, so skipping `review digest` cannot disarm it.
describe('ImplementationReviewGate · unaddressed machine findings (#360)', () => {
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
    await expect(
      new ImplementationReviewGate().check(createVerificationContext()),
    ).resolves.toMatchObject({ passed: true, detail: 'Implementation review passed' });

    await expect(
      new ImplementationReviewGate().check(
        createVerificationContext({ implementation_review_passed: false }),
      ),
    ).resolves.toMatchObject({ passed: false });
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
