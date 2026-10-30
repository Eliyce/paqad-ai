import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ORIGINAL_TITLES from './release-sync-titles.json';

const here = dirname(fileURLToPath(import.meta.url));
const groupFiles = readdirSync(here)
  .filter((file) => /^release-sync\.[a-z-]+\.test\.ts$/.test(file))
  .sort();
const sources = groupFiles.map((file) => readFileSync(join(here, file), 'utf8'));

function titlesOf(source: string): string[] {
  const titles: string[] = [];
  for (const match of source.matchAll(/(?:\bit|\))\(\s*'((?:[^'\\]|\\.)*)'/g)) {
    const title = match[1]!.replace(/\\(.)/g, '$1');
    if (!title.startsWith('release-sync ')) titles.push(title);
  }
  return titles;
}

describe('release-sync test partition', () => {
  it('replaces the single release-sync test file with one file per command group', () => {
    expect(existsSync(join(here, 'release-sync.test.ts'))).toBe(false);
    expect(groupFiles).toEqual([
      'release-sync.ci-green.test.ts',
      'release-sync.prepublish.test.ts',
      'release-sync.scope-diff.test.ts',
      'release-sync.scope-proof.test.ts',
      'release-sync.state.test.ts',
      'release-sync.tags.test.ts',
    ]);
  });

  it('keeps exactly the original test titles across the groups, none in two places', () => {
    const titles = sources.flatMap(titlesOf);
    expect(ORIGINAL_TITLES).toHaveLength(44);
    expect(new Set(titles).size).toBe(titles.length);
    expect([...titles].sort()).toEqual(ORIGINAL_TITLES);
    for (const source of sources) expect(titlesOf(source).length).toBeGreaterThan(0);
  });

  it('keeps every group under its original release-sync describe, skipped on Windows', () => {
    for (const source of sources) {
      expect(source).toMatch(
        /^describe\.skipIf\(process\.platform === 'win32'\)\('release-sync [a-z-]+', \(\) => \{$/m,
      );
    }
  });
});
