import { validateUserFlow } from '@/validators';

describe('validateUserFlow', () => {
  it('accepts valid user flows', () => {
    expect(validateUserFlow('## Actors\nA\n## Preconditions\nP\n## Main Flow\nF').valid).toBe(true);
  });

  it('rejects invalid user flows', () => {
    expect(validateUserFlow('## Actors\nA').valid).toBe(false);
  });
});
