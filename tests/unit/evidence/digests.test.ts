import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ZERO_DIGEST, computeChangeSubjectDigest, computeFileDigests } from '@/evidence/digests.js';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

describe('computeFileDigests', () => {
  it('hashes file bytes and sorts by name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-digests-'));
    writeFileSync(join(root, 'b.ts'), 'beta');
    writeFileSync(join(root, 'a.ts'), 'alpha');

    const digests = await computeFileDigests(root, ['b.ts', 'a.ts']);

    expect(digests.map((d) => d.name)).toEqual(['a.ts', 'b.ts']);
    expect(digests[0].sha256).toBe(sha256('alpha'));
    expect(digests[1].sha256).toBe(sha256('beta'));
  });

  it('falls back to hashing the path for an unreadable/deleted file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-digests-'));
    const digests = await computeFileDigests(root, ['gone.ts']);
    expect(digests[0].sha256).toBe(sha256('gone.ts'));
  });
});

describe('computeChangeSubjectDigest', () => {
  it('is order-independent', () => {
    const a = computeChangeSubjectDigest([
      { name: 'x', sha256: '1' },
      { name: 'y', sha256: '2' },
    ]);
    const b = computeChangeSubjectDigest([
      { name: 'y', sha256: '2' },
      { name: 'x', sha256: '1' },
    ]);
    expect(a).toBe(b);
  });

  it('changes when a file digest changes', () => {
    const before = computeChangeSubjectDigest([{ name: 'x', sha256: '1' }]);
    const after = computeChangeSubjectDigest([{ name: 'x', sha256: '2' }]);
    expect(before).not.toBe(after);
  });

  it('collapses an empty change to the zero digest', () => {
    expect(computeChangeSubjectDigest([])).toBe(ZERO_DIGEST);
  });
});
