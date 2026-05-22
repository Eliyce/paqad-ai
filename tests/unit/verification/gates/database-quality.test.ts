import { describe, expect, it } from 'vitest';

import { DatabaseQualityGate } from '@/verification/gates/database-quality.js';

import { createVerificationContext } from '../shared.fixture.js';

describe('DatabaseQualityGate', () => {
  it('fails when database quality checks fail', async () => {
    await expect(
      new DatabaseQualityGate().check(
        createVerificationContext({ database_quality_passed: false }),
      ),
    ).resolves.toMatchObject({ passed: false });
  });
});
