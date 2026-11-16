import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../..');
const CONTRACT = 'tests/e2e/stage-enforcement-contract.e2e.test.ts';

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const base = git(['merge-base', 'HEAD', 'origin/main']);

describe('AC-40: the stage enforcement contract test stays byte-identical to main', () => {
  it.skipIf(base === null || base === '')('has no change against the main merge base', () => {
    expect(git(['diff', '--name-only', base!, '--', CONTRACT])).toBe('');
  });
});
