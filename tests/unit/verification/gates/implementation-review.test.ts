import { describe, expect, it } from 'vitest';

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
