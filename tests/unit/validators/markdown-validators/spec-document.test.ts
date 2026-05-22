import { validateSpecDocument } from '@/validators';

describe('validateSpecDocument', () => {
  it('accepts valid spec docs', () => {
    const result = validateSpecDocument(
      '## User Story\nStory\n## Acceptance Criteria\nGiven x\nWhen y\nThen z\n## Test Plan\nTests',
    );
    expect(result.valid).toBe(true);
  });

  it('rejects missing headings', () => {
    const result = validateSpecDocument('## User Story\nStory');
    expect(result.valid).toBe(false);
  });
});
