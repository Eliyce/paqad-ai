import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONTRACT, FROZEN_SHA256, contractDigest } from '../../helpers/stage-contract-frozen';

const REPO = resolve(__dirname, '../../..');

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

describe('AC-40: the stage enforcement contract test changes only to the frozen version', () => {
  it.skipIf(base === null || base === '')(
    'any change against the main merge base is the frozen version',
    () => {
      if (git(['diff', '--name-only', base!, '--', CONTRACT]) === '') return;
      expect(contractDigest(REPO)).toBe(FROZEN_SHA256);
    },
  );
});
