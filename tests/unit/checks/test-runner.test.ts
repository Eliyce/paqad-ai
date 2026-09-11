import { describe, expect, it } from 'vitest';

import { selectTestRunner } from '@/checks/test-runner.js';

// The one runner selector (issue #554): trait-named first, then command-named, then first.
describe('selectTestRunner', () => {
  it('prefers the runner whose id matches a detected trait', () => {
    const runner = selectTestRunner(
      { frameworks: ['laravel'], traits: ['phpunit'] },
      'php artisan test',
    );
    expect(runner?.runner_id).toBe('phpunit');
  });

  it('falls back to the runner named in the command', () => {
    const runner = selectTestRunner(
      { frameworks: ['laravel'], traits: [] },
      'run the phpunit suite',
    );
    expect(runner?.runner_id).toBe('phpunit');
  });

  it('falls back to the first structured runner when nothing matches', () => {
    const runner = selectTestRunner({ frameworks: ['laravel'], traits: [] }, 'run everything');
    expect(runner?.runner_id).toBe('pest');
  });

  it('returns null when the stack has no structured runner', () => {
    expect(selectTestRunner({ frameworks: ['does-not-exist'], traits: [] }, 'x')).toBeNull();
  });
});
