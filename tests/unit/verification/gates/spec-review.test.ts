import { describe, expect, it } from 'vitest';

import { SpecReviewGate } from '@/verification/gates/spec-review.js';

import { createVerificationContext } from '../shared.fixture.js';

describe('SpecReviewGate', () => {
  it('fails when spec review fails', async () => {
    await expect(
      new SpecReviewGate().check(createVerificationContext({ spec_review_passed: false })),
    ).resolves.toMatchObject({ passed: false });
  });
});
