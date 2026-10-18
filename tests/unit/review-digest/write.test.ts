import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { writeReviewDigest } from '@/review-digest/index.js';

import {
  DELIVERED_FILES,
  STALE_CACHE_PATH,
  commitAll,
  git,
  makeRepoWithStaleCache,
  writeChangedFilesCache,
  writeRepoFile,
} from '../pipeline/changed-files.fixture.js';

// Issue #360 — the write seam reads the cached inputs and persists the digest. It must
// never throw on a missing input (every source degrades to "none recorded") and must never
// write inside a feature bundle directory (INV-3).
describe('writeReviewDigest', () => {
  let root: string;
  const SES = 'ses_review_digest';
  const NOW = () => new Date('2026-07-21T08:00:00.000Z');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-digest-write-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function write(relative: string, body: unknown): void {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(body), 'utf8');
  }

  function activeFeature(): string {
    return openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'Review digest',
      issue: '360',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });
  }

  it('writes an honest digest in a project with nothing recorded at all', async () => {
    const result = await writeReviewDigest(root, SES, NOW);

    expect(result.path).toBe(PATHS.REVIEW_DIGEST);
    expect(result.feature).toBeNull();
    expect(result.findings).toBe(0);
    const onDisk = readFileSync(join(root, PATHS.REVIEW_DIGEST), 'utf8');
    expect(onDisk).toBe(result.markdown);
    expect(onDisk).toContain('No machine findings recorded');
  });

  it('reads the active feature, its frozen criteria, its stages and the machine findings', async () => {
    const dirName = activeFeature();
    writeFileSync(
      join(root, featureFilePath(dirName, 'specification')),
      JSON.stringify({
        acceptance_criteria: [
          { criterion_id: 'AC-1', given: 'g', when: 'w', then: 't', proof_type: 'test' },
        ],
      }),
      'utf8',
    );
    git(root, ['init', '-q']);
    writeRepoFile(root, '.gitignore', '.paqad/\n');
    writeRepoFile(root, 'src/a.ts', 'export const a = 1;\n');
    write(PATHS.RULE_SCRIPTS_REPORT, {
      results: [
        {
          rule_id: 'RL-6740',
          script: 'a.mjs',
          kind: 'deterministic',
          findings: [{ file: 'src/a.ts', line: 4, message: 'docs disagree', severity: 'high' }],
        },
      ],
    });

    const result = await writeReviewDigest(root, SES, NOW);

    expect(result.feature).toBe(dirName);
    expect(result.findings).toBe(1);
    expect(result.markdown).toContain(`- Feature: ${dirName}`);
    expect(result.markdown).toContain('  - src/a.ts');
    expect(result.markdown).toContain('- AC-1 [test] — given g, when w, then t');
    expect(result.markdown).toContain('src/a.ts:4');
    // The change header reports the stages the ledger folded, not a claim of its own.
    expect(result.markdown).toMatch(/- Stages: \w+=/);
  });

  it('degrades a non-git project and a corrupt specification to "none recorded"', async () => {
    const dirName = activeFeature();
    writeFileSync(join(root, featureFilePath(dirName, 'specification')), 'not json', 'utf8');

    const result = await writeReviewDigest(root, SES, NOW);

    expect(result.markdown).toContain('- Changed files: none recorded');
    expect(result.markdown).toContain('No frozen acceptance criteria on record');
  });

  it('never reads a leftover session cache (issue #646)', async () => {
    writeChangedFilesCache(root, ['src/a.ts']);
    expect((await writeReviewDigest(root, SES, NOW)).markdown).toContain(
      '- Changed files: none recorded',
    );
  });

  it('skips criteria when the frozen spec records none', async () => {
    activeFeature();
    const dirName = (await writeReviewDigest(root, SES, NOW)).feature!;
    writeFileSync(
      join(root, featureFilePath(dirName, 'specification')),
      JSON.stringify({ behaviour: ['x'] }),
      'utf8',
    );
    expect((await writeReviewDigest(root, SES, NOW)).markdown).toContain(
      'No frozen acceptance criteria on record',
    );
  });

  it('writes outside every feature bundle directory (INV-3)', async () => {
    const dirName = activeFeature();
    await writeReviewDigest(root, SES, NOW);
    expect(PATHS.REVIEW_DIGEST.startsWith('.paqad/session/')).toBe(true);
    expect(PATHS.REVIEW_DIGEST).not.toContain(dirName);
  });
});

// Issue #544 / #646 — the digest reads changed files from git alone, so it can never be
// headed by files an already-merged change left in the session cache, nor have edited
// files hidden by a stale cache entry that happens to still be dirty.
describe('writeReviewDigest changed files (issues #544, #646)', () => {
  const SES = 'ses_review_digest_646';
  const NOW = () => new Date('2026-10-18T08:00:00.000Z');
  let root: string;

  beforeEach(() => {
    root = makeRepoWithStaleCache();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('does not list cached files that are clean and already in base history', async () => {
    const { markdown } = await writeReviewDigest(root, SES, NOW);

    for (const file of DELIVERED_FILES) expect(markdown).not.toContain(file);
    expect(markdown).toContain('- Changed files: none recorded');
  });

  it("lists the branch's real changes, not the stale cache", async () => {
    writeRepoFile(root, 'src/new-work.ts', 'export const work = 1;\n');
    writeRepoFile(root, 'tests/new-work.test.ts', 'it.todo("work");\n');

    const { markdown } = await writeReviewDigest(root, SES, NOW);

    expect(markdown).toContain('- Changed files (2):');
    expect(markdown).toContain('  - src/new-work.ts');
    expect(markdown).toContain('  - tests/new-work.test.ts');
    for (const file of DELIVERED_FILES) expect(markdown).not.toContain(file);
  });

  it('AC-3: lists files only committed on the branch when the tree is clean', async () => {
    writeRepoFile(root, 'src/branch-work.ts', 'export const work = 1;\n');
    commitAll(root, 'branch work');

    const { markdown } = await writeReviewDigest(root, SES, NOW);

    expect(markdown).toContain('- Changed files (1):');
    expect(markdown).toContain('  - src/branch-work.ts');
  });

  it('with no cache and a clean tree, still reads "none recorded"', async () => {
    rmSync(join(root, STALE_CACHE_PATH));

    const { markdown } = await writeReviewDigest(root, SES, NOW);

    expect(markdown).toContain('- Changed files: none recorded');
  });
});

// Issue #646 AC-6 — the #644 scenario: a stale cache of many entries, one of them with a
// mode-only change, and 12 other source files edited. The old reconcile kept only the
// mode-changed entry and hid the 12 real edits; the digest must list every edited file.
describe('writeReviewDigest on the #644 scenario (issue #646 AC-6)', () => {
  const SES = 'ses_review_digest_644';
  const NOW = () => new Date('2026-10-18T08:00:00.000Z');
  const CACHED = Array.from({ length: 8 }, (_, index) => `src/cached-${index}.ts`);
  const EDITED = Array.from({ length: 12 }, (_, index) => `src/edited-${index}.ts`);
  let root: string;

  beforeEach(() => {
    root = makeRepoWithStaleCache([...CACHED, ...EDITED.slice(0, 6)]);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('lists every edited file, not just the mode-changed cache entry', async () => {
    // A mode-only change, staged so it shows on every platform (core.fileMode varies).
    git(root, ['update-index', '--chmod=+x', CACHED[0]!]);
    // Six committed files modified in place, six brand-new files.
    for (const file of EDITED) writeRepoFile(root, file, 'export const edited = 2;\n');

    const expected = [CACHED[0]!, ...EDITED].sort();
    await expect(loadChangeEvidence(root)).resolves.toEqual({ files: expected, source: 'git' });

    const { markdown } = await writeReviewDigest(root, SES, NOW);

    // The header counts every edited file; the digest shows the first 12 and folds the
    // rest into an "…and N more" line, so together they account for all 13.
    expect(markdown).toContain(`- Changed files (${expected.length}):`);
    const listed = markdown
      .split('\n')
      .filter((line) => line.startsWith('  - src/'))
      .map((line) => line.slice('  - '.length));
    expect(listed).toEqual(expected.slice(0, listed.length));
    expect(markdown).toContain(`  - …and ${expected.length - listed.length} more`);
    expect(listed).toContain(CACHED[0]);
    for (const file of CACHED.slice(1)) expect(markdown).not.toContain(file);
  });
});
