import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  loadChangeEvidence,
  loadReconciledChangedFiles,
  readChangedFilesArtifact,
} from '@/pipeline/change-evidence.js';
import { syncModuleHealth } from '@/planning/module-health-updater.js';
import { writeReviewDigest } from '@/review-digest/index.js';
import { gatherTraceabilityInputs } from '@/traceability/inputs.js';

import {
  DELIVERED_FILES,
  makeRepoWithStaleCache,
  writeChangedFilesCache,
  writeRepoFile,
} from './changed-files.fixture.js';

// Issue #544 — `.paqad/session/changed-files.json` has exactly one reader and one shape
// (a bare JSON array). Before this, five readers hand-parsed it: three skipped the git
// reconcile and could describe an already-delivered change, and traceability read a
// `{ files }` shape nothing writes, so it never saw a single changed file.

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) return sourceFiles(abs);
    return /\.[cm]?[jt]sx?$/.test(name) ? [abs] : [];
  });
}

describe('readChangedFilesArtifact (the one parser)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-544-artifact-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns an empty list when the cache is absent (INV-2)', () => {
    expect(readChangedFilesArtifact(root)).toEqual([]);
  });

  it('returns an empty list for corrupt JSON and for a non-array shape (INV-3)', () => {
    writeRepoFile(root, PATHS.CHANGED_FILES, '{not json');
    expect(readChangedFilesArtifact(root)).toEqual([]);

    writeChangedFilesCache(root, { files: ['src/a.ts'] });
    expect(readChangedFilesArtifact(root)).toEqual([]);
  });

  it('keeps only strings, normalizes separators, de-duplicates and sorts', () => {
    writeChangedFilesCache(root, ['src\\b.ts', 'src/a.ts', 7, 'src/a.ts', null]);
    expect(readChangedFilesArtifact(root)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('loadReconciledChangedFiles (reconcile, no git-status fallback)', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns the cache unchanged where git cannot bound the change', async () => {
    root = mkdtempSync(join(tmpdir(), 'paqad-544-nogit-'));
    writeChangedFilesCache(root, ['src/a.ts']);
    await expect(loadReconciledChangedFiles(root)).resolves.toEqual(['src/a.ts']);
  });

  it('drops entries that are clean and already in base history', async () => {
    root = makeRepoWithStaleCache();
    writeRepoFile(root, DELIVERED_FILES[1]!, 'export const delivered = 2;\n');
    await expect(loadReconciledChangedFiles(root)).resolves.toEqual([DELIVERED_FILES[1]]);
  });

  it('never falls back to git status: no cache means no files (AC-6)', async () => {
    root = makeRepoWithStaleCache();
    rmSync(join(root, PATHS.CHANGED_FILES));
    writeRepoFile(root, 'src/live.ts', 'export const live = 1;\n');

    await expect(loadReconciledChangedFiles(root)).resolves.toEqual([]);
    // ...while the canonical evidence reader still sees the live change.
    await expect(loadChangeEvidence(root)).resolves.toEqual({
      files: ['src/live.ts'],
      source: 'git-status',
    });
  });
});

describe('every reader agrees on the bare-array shape (AC-3, AC-4)', () => {
  let root: string;
  const CACHED = ['src/feature.ts', 'src/helper.ts'];

  beforeEach(() => {
    // Not a git repo: no reader can reconcile, so each must return the cache as-is.
    root = mkdtempSync(join(tmpdir(), 'paqad-544-agree-'));
    writeRepoFile(root, 'src/feature.ts', 'export const f = 1;\n');
    writeRepoFile(root, 'src/helper.ts', 'export const h = 1;\n');
    writeChangedFilesCache(root, CACHED);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('writes the cache on disk as a bare JSON array', () => {
    const onDisk: unknown = JSON.parse(readFileSync(join(root, PATHS.CHANGED_FILES), 'utf8'));
    expect(Array.isArray(onDisk)).toBe(true);
  });

  it('AC-3: traceability inputs return the file list (they used to be always empty)', async () => {
    const inputs = await gatherTraceabilityInputs({ projectRoot: root, lane: 'fast' });
    expect(inputs.changedFiles).toEqual(CACHED);
  });

  it('AC-4: evidence, reconciled reader, traceability and the digest list the same files', async () => {
    const evidence = await loadChangeEvidence(root);
    const reconciled = await loadReconciledChangedFiles(root);
    const traceability = (await gatherTraceabilityInputs({ projectRoot: root, lane: 'fast' }))
      .changedFiles;
    const { markdown } = await writeReviewDigest(root, 'ses_544', () => new Date(0));

    expect(evidence).toEqual({ files: CACHED, source: 'session-artifact' });
    expect(reconciled).toEqual(CACHED);
    expect(traceability).toEqual(CACHED);
    expect(markdown).toContain(`- Changed files (${CACHED.length}):`);
    for (const file of CACHED) expect(markdown).toContain(`  - ${file}`);
  });

  it('AC-4: only src/pipeline/change-evidence.ts reads PATHS.CHANGED_FILES', () => {
    const readers = sourceFiles(join(REPO_ROOT, 'src'))
      .filter((file) => readFileSync(file, 'utf8').includes('PATHS.CHANGED_FILES'))
      .map((file) => relative(REPO_ROOT, file).replace(/\\/g, '/'));
    expect(readers).toEqual(['src/pipeline/change-evidence.ts']);
  });
});

describe('module-health session evidence (AC-5, AC-6)', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('AC-5: records no session evidence for files an already-delivered change left behind', async () => {
    root = makeRepoWithStaleCache();

    const result = await syncModuleHealth({
      projectRoot: root,
      provider: 'claude-code',
      source: 'provider-hook',
      silent: true,
    });

    expect(result.updated_profiles).toEqual([]);
  });

  it('AC-6: an absent cache still records nothing and never throws', async () => {
    root = mkdtempSync(join(tmpdir(), 'paqad-544-mh-'));

    await expect(
      syncModuleHealth({ projectRoot: root, source: 'provider-hook', silent: true }),
    ).resolves.toMatchObject({ updated_profiles: [] });
  });
});
