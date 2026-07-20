import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { detectNewCodeDuplication } from '@/duplication/detect.js';
import type { DuplicationConfig } from '@/duplication/config.js';

import {
  commitAll,
  makeGitProject,
  writeChunkIndex,
  writeCodeKnowledgeIndex,
  writeProjectFile,
} from './helpers.js';

const WARN: DuplicationConfig = { mode: 'warn', similarityThreshold: 0.9, minLines: 8 };

const HELPER = `export function formatIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + day + ' ' + hh + ':' + mm;
}`;

const NEAR_COPY = `export function toStamp(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + day + ' ' + hh + ':' + mm;
}`;

describe('detectNewCodeDuplication', () => {
  it('AC-1: flags a >=8-line near-copy of an existing helper with the full message', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/dates.ts', `${HELPER}\n`);
    commitAll(root);
    writeChunkIndex(root, { 'src/dates.ts': HELPER });
    writeProjectFile(root, 'src/stamp.ts', `${NEAR_COPY}\n`);

    const findings = await detectNewCodeDuplication({
      projectRoot: root,
      changedFiles: ['src/stamp.ts'],
      config: WARN,
      corroborate: false,
    });
    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.file).toBe('src/stamp.ts');
    expect(finding.matched_file).toBe('src/dates.ts');
    expect(finding.similarity).toBeGreaterThanOrEqual(0.9);
    expect(finding.kind).toBe('deterministic');
    expect(finding.message).toContain('New code in src/stamp.ts:');
    expect(finding.message).toContain('% similar to existing');
    expect(finding.message).toContain('call sites');
  });

  it('AC-2: reports nothing for legacy duplication the change did not touch', async () => {
    const root = makeGitProject();
    // Two pre-existing duplicate files, both committed and in the index.
    writeProjectFile(root, 'src/a.ts', `${HELPER}\n`);
    writeProjectFile(root, 'src/b.ts', `${NEAR_COPY}\n`);
    commitAll(root);
    writeChunkIndex(root, { 'src/a.ts': HELPER, 'src/b.ts': NEAR_COPY });
    // The change touches an unrelated third file.
    writeProjectFile(root, 'src/c.ts', 'export const c = 1;\n');

    const findings = await detectNewCodeDuplication({
      projectRoot: root,
      changedFiles: ['src/c.ts'],
      config: WARN,
      corroborate: false,
    });
    expect(findings).toEqual([]);
  });

  it('AC-3: does not flag a moved function against its own removed original', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/from.ts', `${HELPER}\n`);
    commitAll(root);
    writeChunkIndex(root, { 'src/from.ts': HELPER });
    // Move: delete from `from.ts`, add the same function to `to.ts`. Both are changed files.
    rmSync(join(root, 'src/from.ts'));
    writeProjectFile(root, 'src/to.ts', `${HELPER}\n`);

    const findings = await detectNewCodeDuplication({
      projectRoot: root,
      changedFiles: ['src/from.ts', 'src/to.ts'],
      config: WARN,
      corroborate: false,
    });
    expect(findings).toEqual([]);
  });

  it('AC-6: still functions with no embedding index (token fallback)', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/dates.ts', `${HELPER}\n`);
    commitAll(root);
    // Only the chunk index exists; there is no .paqad/vectors/ embedding index at all.
    writeChunkIndex(root, { 'src/dates.ts': HELPER });
    writeProjectFile(root, 'src/stamp.ts', `${NEAR_COPY}\n`);

    const findings = await detectNewCodeDuplication({
      projectRoot: root,
      changedFiles: ['src/stamp.ts'],
      config: WARN,
      corroborate: false,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.matched_file).toBe('src/dates.ts');
  });

  it('respects the min-lines floor', async () => {
    const root = makeGitProject();
    const short = 'export function tiny() {\n  return 1 + 2;\n}';
    writeProjectFile(root, 'src/tiny.ts', `${short}\n`);
    commitAll(root);
    writeChunkIndex(root, { 'src/tiny.ts': short });
    writeProjectFile(root, 'src/tiny2.ts', 'export function tiny2() {\n  return 1 + 2;\n}\n');

    const findings = await detectNewCodeDuplication({
      projectRoot: root,
      changedFiles: ['src/tiny2.ts'],
      config: WARN,
      corroborate: false,
    });
    expect(findings).toEqual([]);
  });

  it('is a no-op when the mode is off', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/dates.ts', `${HELPER}\n`);
    commitAll(root);
    writeChunkIndex(root, { 'src/dates.ts': HELPER });
    writeProjectFile(root, 'src/stamp.ts', `${NEAR_COPY}\n`);
    const findings = await detectNewCodeDuplication({
      projectRoot: root,
      changedFiles: ['src/stamp.ts'],
      config: { ...WARN, mode: 'off' },
      corroborate: false,
    });
    expect(findings).toEqual([]);
  });

  it('enriches the finding with the matched symbol and caller count from the index', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/dates.ts', `${HELPER}\n`);
    commitAll(root);
    writeChunkIndex(root, { 'src/dates.ts': HELPER });
    writeCodeKnowledgeIndex(root, [
      { name: 'formatIsoDate', file: 'src/dates.ts', line: 1, caller_count: 4 },
    ]);
    writeProjectFile(root, 'src/stamp.ts', `${NEAR_COPY}\n`);

    const [finding] = await detectNewCodeDuplication({
      projectRoot: root,
      changedFiles: ['src/stamp.ts'],
      config: WARN,
      corroborate: false,
    });
    expect(finding!.matched_symbol).toBe('formatIsoDate');
    expect(finding!.matched_callers).toBe(4);
    expect(finding!.message).toContain('used by 4 call sites');
  });

  it('routes a match in the 0.80–0.90 band to review as heuristic (never blocks)', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/dates.ts', `${HELPER}\n`);
    commitAll(root);
    writeChunkIndex(root, { 'src/dates.ts': HELPER });
    writeProjectFile(root, 'src/stamp.ts', `${NEAR_COPY}\n`);
    // A high threshold pushes the ~0.93 match below the blocking bar but above the review floor.
    const [finding] = await detectNewCodeDuplication({
      projectRoot: root,
      changedFiles: ['src/stamp.ts'],
      config: { mode: 'strict', similarityThreshold: 0.99, minLines: 8 },
      corroborate: false,
    });
    expect(finding!.kind).toBe('heuristic');
  });

  it('falls back to the new-code range when the matched content is not on disk', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/dates.ts', `${HELPER}\n`);
    commitAll(root);
    // The index carries content that no longer appears verbatim in the matched file, so its
    // line range cannot be resolved — the finding falls back to the new code's own range.
    writeChunkIndex(root, { 'src/dates.ts': `${HELPER}\n// index drift` });
    writeProjectFile(root, 'src/stamp.ts', `${NEAR_COPY}\n`);

    const [finding] = await detectNewCodeDuplication({
      projectRoot: root,
      changedFiles: ['src/stamp.ts'],
      config: WARN,
      corroborate: false,
    });
    expect(finding!.matched_line_range).toEqual(finding!.line_range);
  });

  it('scores only the added function when a file mixes old and new code', async () => {
    const root = makeGitProject();
    // A large pre-existing function (>2000 chars) so the AST chunker keeps it a separate chunk
    // from the appended near-copy, exercising the "chunk not in the added range" skip.
    const body = Array.from({ length: 120 }, (_, i) => `  const v${i} = compute(${i});`).join('\n');
    const preExisting = `export function existing() {\n${body}\n  return 0;\n}`;
    writeProjectFile(root, 'src/dates.ts', `${HELPER}\n`);
    writeProjectFile(root, 'src/mixed.ts', `${preExisting}\n`);
    commitAll(root);
    writeChunkIndex(root, { 'src/dates.ts': HELPER, 'src/mixed.ts': preExisting });
    // Append a near-copy of dates.ts to the already-committed mixed.ts.
    writeProjectFile(root, 'src/mixed.ts', `${preExisting}\n${NEAR_COPY}\n`);

    const findings = await detectNewCodeDuplication({
      projectRoot: root,
      changedFiles: ['src/mixed.ts'],
      config: WARN,
      corroborate: false,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.matched_file).toBe('src/dates.ts');
    // The pre-existing `existing()` function was not in the added range, so it never scored.
    expect(findings[0]!.line_range.start).toBeGreaterThan(120);
  });

  it('does not flag brand-new code that resembles nothing existing', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/dates.ts', `${HELPER}\n`);
    commitAll(root);
    writeChunkIndex(root, { 'src/dates.ts': HELPER });
    const unrelated =
      'export function unrelated() {\n' +
      '  const items = [];\n' +
      '  for (const x of source) items.push(transform(x));\n' +
      '  return items.filter(Boolean).length;\n' +
      '}';
    writeProjectFile(root, 'src/new.ts', `${unrelated}\n`);

    const findings = await detectNewCodeDuplication({
      projectRoot: root,
      changedFiles: ['src/new.ts'],
      config: WARN,
      corroborate: false,
    });
    expect(findings).toEqual([]);
  });

  it('picks the best match across many corpus chunks of varied size', async () => {
    const root = makeGitProject();
    // An unrelated chunk of similar size (scores low, seeds `best`), then the true match (higher
    // → updates best), then a smaller unrelated chunk (lower → does not update; also exercises
    // the a>b size-ratio direction). tiny is filtered out by the min-lines floor.
    const unrelatedA = `export function alpha() {\n${'  step(a);\n'.repeat(9)}  return a;\n}`;
    const unrelatedB = `export function beta() {\n${'  go(b);\n'.repeat(8)}}`;
    const tiny = 'export const tinyThing = 1;';
    writeProjectFile(root, 'src/a.ts', `${unrelatedA}\n`);
    writeProjectFile(root, 'src/dates.ts', `${HELPER}\n`);
    writeProjectFile(root, 'src/b.ts', `${unrelatedB}\n`);
    writeProjectFile(root, 'src/tiny.ts', `${tiny}\n`);
    commitAll(root);
    writeChunkIndex(root, {
      'src/a.ts': unrelatedA,
      'src/dates.ts': HELPER,
      'src/b.ts': unrelatedB,
      'src/tiny.ts': tiny,
    });
    writeProjectFile(root, 'src/stamp.ts', `${NEAR_COPY}\n`);

    const findings = await detectNewCodeDuplication({
      projectRoot: root,
      changedFiles: ['src/stamp.ts'],
      config: WARN,
      corroborate: false,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.matched_file).toBe('src/dates.ts');
  });

  it('falls back to no symbol when the index has none for the matched range', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/dates.ts', `${HELPER}\n`);
    commitAll(root);
    writeChunkIndex(root, { 'src/dates.ts': HELPER });
    // A symbol in the matched file but OUTSIDE the matched range and not an exported name here.
    writeCodeKnowledgeIndex(root, [
      { name: 'elsewhere', file: 'src/dates.ts', line: 999, caller_count: 7 },
    ]);
    writeProjectFile(root, 'src/stamp.ts', `${NEAR_COPY}\n`);

    const [finding] = await detectNewCodeDuplication({
      projectRoot: root,
      changedFiles: ['src/stamp.ts'],
      config: WARN,
      corroborate: false,
    });
    expect(finding!.matched_symbol).toBeUndefined();
    expect(finding!.matched_callers).toBe(0);
  });

  it('returns nothing with no changed files and no corpus', async () => {
    const root = makeGitProject();
    expect(
      await detectNewCodeDuplication({ projectRoot: root, changedFiles: [], config: WARN }),
    ).toEqual([]);
  });

  it('returns nothing when the corpus is empty', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/stamp.ts', `${NEAR_COPY}\n`);
    commitAll(root);
    // No chunk index written → empty corpus.
    writeFileSync(join(root, 'src/stamp.ts'), `${NEAR_COPY}\n// changed\n`);
    expect(
      await detectNewCodeDuplication({
        projectRoot: root,
        changedFiles: ['src/stamp.ts'],
        config: WARN,
        corroborate: false,
      }),
    ).toEqual([]);
  });
});
