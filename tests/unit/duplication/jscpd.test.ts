import { describe, expect, it } from 'vitest';

import {
  corroborateWithJscpd,
  isCorroborated,
  jscpdLocationKeys,
  locationKey,
} from '@/duplication/jscpd.js';
import type { DuplicationCluster } from '@/codebase-health/detectors.js';

const cluster: DuplicationCluster = {
  lines: 10,
  source: 'jscpd',
  blocks: [
    { file: 'src/a.ts', start_line: 12, end_line: 21 },
    { file: 'src/b.ts', start_line: 40, end_line: 49 },
  ],
};

describe('locationKey / jscpdLocationKeys', () => {
  it('normalizes separators into a file:line key', () => {
    expect(locationKey('src\\a.ts', 5)).toBe('src/a.ts:5');
  });

  it('collects one key per block start', () => {
    expect(jscpdLocationKeys([cluster])).toEqual(new Set(['src/a.ts:12', 'src/b.ts:40']));
  });
});

describe('isCorroborated', () => {
  const keys = jscpdLocationKeys([cluster]);
  it('is true when a block start falls inside the finding range', () => {
    expect(isCorroborated('src/a.ts', 10, 15, keys)).toBe(true);
  });
  it('is false when no block overlaps', () => {
    expect(isCorroborated('src/a.ts', 30, 35, keys)).toBe(false);
  });
});

describe('corroborateWithJscpd', () => {
  it('returns an empty set for no changed files', async () => {
    expect((await corroborateWithJscpd({ projectRoot: '/tmp', changedFiles: [] })).size).toBe(0);
  });

  it('degrades to an empty set when jscpd is not on PATH', async () => {
    // jscpd is not installed in CI; the spawn fails and the function returns empty, never throws.
    const keys = await corroborateWithJscpd({ projectRoot: '/tmp', changedFiles: ['src/a.ts'] });
    expect(keys.size).toBe(0);
  });
});
