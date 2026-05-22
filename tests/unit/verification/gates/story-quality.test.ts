import { describe, expect, it } from 'vitest';

import { StoryQualityGate } from '@/verification/gates/story-quality.js';

import { createVerificationContext } from '../shared.fixture.js';

describe('StoryQualityGate', () => {
  it('fails when story quality checks fail', async () => {
    await expect(
      new StoryQualityGate().check(createVerificationContext({ story_quality_passed: false })),
    ).resolves.toMatchObject({ passed: false });
  });
});
