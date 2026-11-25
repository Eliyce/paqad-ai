import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONTRACT = 'tests/e2e/stage-enforcement-contract.e2e.test.ts';
export const FROZEN_SHA256 = '083a459c20efa86510e03e25972a0afcff5bcc13c5b986ead0e584f77bfbe346';

export function contractDigest(repo: string): string {
  return createHash('sha256')
    .update(readFileSync(join(repo, CONTRACT)))
    .digest('hex');
}
