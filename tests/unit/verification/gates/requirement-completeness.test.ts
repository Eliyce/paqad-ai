import { describe, expect, it } from 'vitest';

import { RequirementCompletenessGate } from '@/verification/gates/requirement-completeness.js';

import { createVerificationContext } from '../shared.fixture.js';

describe('RequirementCompletenessGate', () => {
  it('fails when requirements are incomplete', async () => {
    await expect(
      new RequirementCompletenessGate().check(
        createVerificationContext({ requirements_complete: false }),
      ),
    ).resolves.toMatchObject({ passed: false });
  });
});
