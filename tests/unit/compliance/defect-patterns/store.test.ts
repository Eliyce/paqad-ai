import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  defaultStoreRoot,
  loadEntry,
  loadIndex,
  markStaleEntries,
  prunePatterns,
  queryPatterns,
  recordFindings,
} from '@/compliance/defect-patterns/store.js';
import type { DefectFinding } from '@/compliance/defect-patterns/types.js';
import { DEFECT_PATTERN_SCHEMA_VERSION } from '@/compliance/defect-patterns/types.js';

async function tempStore(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'paqad-dp-'));
}

function makeFinding(overrides: Partial<DefectFinding> = {}): DefectFinding {
  return {
    defect_id: 'spec.md:FR-1-T1',
    source: 'compliance',
    category: 'D5',
    subcategory: 'D5.missing-boundary',
    spec_file: 'docs/spec.md',
    obligation_id: 'FR-1-T1',
    stack_context: { frameworks: ['react'], traits: ['typescript'] },
    description: 'Boundary at exactly 2000 chars not handled.',
    file_path: 'src/compliance/checker.ts',
    recorded_at: new Date().toISOString(),
    resolved: false,
    recurrence_count: 1,
    ...overrides,
  };
}

describe('recordFindings + loadIndex', () => {
  it('creates a new pattern entry on first recording (FR-DP3-T1)', async () => {
    const root = await tempStore();
    await recordFindings([makeFinding()], root);
    const index = await loadIndex(root);

    expect(index.schema_version).toBe(DEFECT_PATTERN_SCHEMA_VERSION);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]!.subcategory).toBe('D5.missing-boundary');
    expect(index.entries[0]!.frequency).toBe(1);
  });

  it('increments frequency on second recording of the same subcategory (FR-DP3-T2)', async () => {
    const root = await tempStore();
    const finding = makeFinding();
    await recordFindings([finding], root);
    await recordFindings([makeFinding({ description: 'Another boundary issue.' })], root);
    const index = await loadIndex(root);

    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]!.frequency).toBe(2);
  });

  it('updates last_seen on subsequent recordings', async () => {
    const root = await tempStore();
    const t1 = new Date(Date.now() - 1000).toISOString();
    const t2 = new Date().toISOString();
    await recordFindings([makeFinding({ recorded_at: t1 })], root);
    await recordFindings([makeFinding({ recorded_at: t2 })], root);
    const index = await loadIndex(root);

    expect(index.entries[0]!.last_seen).toBe(t2);
  });

  it('no-ops when findings array is empty', async () => {
    const root = await tempStore();
    await recordFindings([], root);
    const index = await loadIndex(root);
    expect(index.entries).toHaveLength(0);
  });

  it('caps example_obligations at 5 (FR-DP3-T5 / EC-DP4-T1)', async () => {
    const root = await tempStore();
    for (let i = 0; i < 10; i++) {
      await recordFindings([makeFinding({ description: `Boundary issue ${i}` })], root);
    }
    const entry = await loadEntry((await loadIndex(root)).entries[0]!.pattern_id, root);
    expect(entry!.example_obligations.length).toBeLessThanOrEqual(5);
    expect(entry!.frequency).toBe(10);
  });

  it('caps example_files at 5', async () => {
    const root = await tempStore();
    for (let i = 0; i < 10; i++) {
      await recordFindings([makeFinding({ file_path: `src/file${i}.ts` })], root);
    }
    const entry = await loadEntry((await loadIndex(root)).entries[0]!.pattern_id, root);
    expect(entry!.example_files.length).toBeLessThanOrEqual(5);
  });

  it('does not duplicate stack contexts already present', async () => {
    const root = await tempStore();
    const sc = { frameworks: ['react'], traits: [] };
    await recordFindings([makeFinding({ stack_context: sc })], root);
    await recordFindings([makeFinding({ stack_context: sc })], root);
    const entry = await loadEntry((await loadIndex(root)).entries[0]!.pattern_id, root);
    expect(entry!.stack_contexts).toHaveLength(1);
  });

  it('adds a new stack context when frameworks differ', async () => {
    const root = await tempStore();
    await recordFindings(
      [makeFinding({ stack_context: { frameworks: ['react'], traits: [] } })],
      root,
    );
    await recordFindings(
      [makeFinding({ stack_context: { frameworks: ['vue'], traits: [] } })],
      root,
    );
    const entry = await loadEntry((await loadIndex(root)).entries[0]!.pattern_id, root);
    expect(entry!.stack_contexts).toHaveLength(2);
  });

  it('finding with null obligation_id produces no example_obligation entry', async () => {
    const root = await tempStore();
    await recordFindings([makeFinding({ obligation_id: null })], root);
    const entry = await loadEntry((await loadIndex(root)).entries[0]!.pattern_id, root);
    expect(entry!.example_obligations).toHaveLength(0);
  });

  it('finding with null file_path produces no example_file entry', async () => {
    const root = await tempStore();
    await recordFindings([makeFinding({ file_path: null })], root);
    const entry = await loadEntry((await loadIndex(root)).entries[0]!.pattern_id, root);
    expect(entry!.example_files).toHaveLength(0);
  });
});

describe('queryPatterns', () => {
  it('returns patterns matching min_frequency and max_age_days (FR-DP3-T3)', async () => {
    const root = await tempStore();
    // Record 4 findings under the same subcategory so frequency = 4
    for (let i = 0; i < 4; i++) {
      await recordFindings([makeFinding()], root);
    }
    const results = await queryPatterns({ min_frequency: 3 }, root);
    expect(results).toHaveLength(1);
    expect(results[0]!.frequency).toBe(4);
  });

  it('excludes patterns below min_frequency', async () => {
    const root = await tempStore();
    await recordFindings([makeFinding()], root); // frequency = 1
    const results = await queryPatterns({ min_frequency: 3 }, root);
    expect(results).toHaveLength(0);
  });

  it('excludes stale patterns', async () => {
    const root = await tempStore();
    for (let i = 0; i < 5; i++) {
      await recordFindings([makeFinding()], root);
    }
    const index = await loadIndex(root);
    // Manually mark entry as stale
    index.entries[0]!.stale = true;
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(path.join(root, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
    const results = await queryPatterns({ min_frequency: 1 }, root);
    expect(results).toHaveLength(0);
  });

  it('excludes patterns older than max_age_days based on last_seen timestamp', async () => {
    const root = await tempStore();
    const oldTimestamp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    for (let i = 0; i < 4; i++) {
      await recordFindings([makeFinding({ recorded_at: oldTimestamp })], root);
    }
    const results = await queryPatterns({ min_frequency: 1, max_age_days: 1 }, root);
    expect(results).toHaveLength(0);
  });

  it('filters by stack context — returns only matching frameworks (FR-DP3-T3)', async () => {
    const root = await tempStore();
    for (let i = 0; i < 4; i++) {
      await recordFindings(
        [makeFinding({ stack_context: { frameworks: ['go'], traits: [] } })],
        root,
      );
    }
    for (let i = 0; i < 4; i++) {
      await recordFindings(
        [
          makeFinding({
            subcategory: 'D5.missing-cli-surface',
            stack_context: { frameworks: ['react'], traits: [] },
          }),
        ],
        root,
      );
    }
    const goResults = await queryPatterns(
      { min_frequency: 1, stack_context: { frameworks: ['go'], traits: [] } },
      root,
    );
    expect(
      goResults.every((p) => p.stack_contexts.some((sc) => sc.frameworks.includes('go'))),
    ).toBe(true);
    expect(goResults.some((p) => p.subcategory === 'D5.missing-cli-surface')).toBe(false);
  });

  it('empty stack context matches all patterns', async () => {
    const root = await tempStore();
    for (let i = 0; i < 4; i++) {
      await recordFindings([makeFinding()], root);
    }
    const all = await queryPatterns(
      { min_frequency: 1, stack_context: { frameworks: [], traits: [] } },
      root,
    );
    expect(all).toHaveLength(1);
  });

  it('returns empty array when store is empty (EC-DP1-T1)', async () => {
    const root = await tempStore();
    const results = await queryPatterns({}, root);
    expect(results).toHaveLength(0);
  });

  it('respects limit option (FR-DP5-T2)', async () => {
    const root = await tempStore();
    const subcats = ['D5.missing-boundary', 'D5.missing-cli-surface', 'D5.missing-error-handling'];
    for (const sub of subcats) {
      for (let i = 0; i < 4; i++) {
        await recordFindings([makeFinding({ subcategory: sub })], root);
      }
    }
    const results = await queryPatterns({ min_frequency: 1, limit: 2 }, root);
    expect(results).toHaveLength(2);
  });

  it('skips missing entry files gracefully', async () => {
    const root = await tempStore();
    for (let i = 0; i < 4; i++) {
      await recordFindings([makeFinding()], root);
    }
    const index = await loadIndex(root);
    // Delete the entry file
    const { unlink } = await import('node:fs/promises');
    await unlink(path.join(root, 'entries', `${index.entries[0]!.pattern_id}.json`));
    const results = await queryPatterns({ min_frequency: 1 }, root);
    expect(results).toHaveLength(0);
  });
});

describe('prunePatterns', () => {
  it('removes patterns older than the threshold (FR-DP6-T3)', async () => {
    const root = await tempStore();
    const oldTimestamp = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    await recordFindings([makeFinding({ recorded_at: oldTimestamp })], root);
    // Manually adjust index last_seen to be old
    const index = await loadIndex(root);
    index.entries[0]!.last_seen = oldTimestamp;
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(path.join(root, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');

    const removed = await prunePatterns(365, root);
    expect(removed).toBe(1);
    const afterIndex = await loadIndex(root);
    expect(afterIndex.entries).toHaveLength(0);
  });

  it('returns 0 when nothing is old enough to prune', async () => {
    const root = await tempStore();
    await recordFindings([makeFinding()], root);
    const removed = await prunePatterns(365, root);
    expect(removed).toBe(0);
  });

  it('handles missing entry file during prune gracefully', async () => {
    const root = await tempStore();
    const oldTimestamp = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    await recordFindings([makeFinding({ recorded_at: oldTimestamp })], root);
    const index = await loadIndex(root);
    index.entries[0]!.last_seen = oldTimestamp;
    const { writeFile: wf, unlink } = await import('node:fs/promises');
    await wf(path.join(root, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
    // Pre-delete the entry file to simulate missing file
    await unlink(path.join(root, 'entries', `${index.entries[0]!.pattern_id}.json`));

    await expect(prunePatterns(365, root)).resolves.toBe(1);
  });
});

describe('loadIndex — rebuild from entries on corrupt index (EC-DP3)', () => {
  it('rebuilds the index when index.json is corrupt', async () => {
    const root = await tempStore();
    await recordFindings([makeFinding()], root);
    // Corrupt the index
    await writeFile(path.join(root, 'index.json'), '{not-json', 'utf8');
    const rebuilt = await loadIndex(root);
    expect(rebuilt.entries).toHaveLength(1);
  });

  it('rebuilds an empty index when there are no entry files', async () => {
    const root = await tempStore();
    await writeFile(path.join(root, 'index.json'), '{invalid}', 'utf8');
    const rebuilt = await loadIndex(root);
    expect(rebuilt.entries).toHaveLength(0);
  });

  it('skips corrupt entry files during rebuild with a warning (EC-DP3-T2)', async () => {
    const root = await tempStore();
    await mkdir(path.join(root, 'entries'), { recursive: true });
    await writeFile(path.join(root, 'entries', 'bad.json'), '{corrupt', 'utf8');
    await writeFile(path.join(root, 'index.json'), '{invalid}', 'utf8');
    // Should not throw; corrupt entry is skipped
    const rebuilt = await loadIndex(root);
    expect(rebuilt.entries).toHaveLength(0);
  });

  it('ignores non-json files while rebuilding from entries', async () => {
    const root = await tempStore();
    await mkdir(path.join(root, 'entries'), { recursive: true });
    await writeFile(path.join(root, 'entries', 'notes.txt'), 'ignore me', 'utf8');
    await writeFile(path.join(root, 'index.json'), '{invalid}', 'utf8');
    const rebuilt = await loadIndex(root);
    expect(rebuilt.entries).toHaveLength(0);
  });

  it('returns a default index when store root does not exist', async () => {
    const root = path.join(os.tmpdir(), 'paqad-dp-nonexistent-' + Date.now());
    const index = await loadIndex(root);
    expect(index.entries).toHaveLength(0);
    expect(index.schema_version).toBe(DEFECT_PATTERN_SCHEMA_VERSION);
  });

  it('rebuilds when index.json has valid JSON with invalid structure', async () => {
    const root = await tempStore();
    await mkdir(path.join(root, 'entries'), { recursive: true });
    await writeFile(path.join(root, 'index.json'), JSON.stringify({ schema_version: '1' }), 'utf8');
    const rebuilt = await loadIndex(root);
    expect(rebuilt.entries).toEqual([]);
  });
});

describe('defaultStoreRoot', () => {
  it('resolves under the current user home directory', () => {
    expect(defaultStoreRoot()).toBe(path.join(os.homedir(), '.paqad', 'defect-patterns'));
  });
});

describe('loadEntry', () => {
  it('returns null when entry file does not exist', async () => {
    const root = await tempStore();
    expect(await loadEntry('nonexistent', root)).toBeNull();
  });
});

describe('recordFindings existing-entry edge cases', () => {
  it('keeps index stable when an existing index entry points to a missing entry file', async () => {
    const root = await tempStore();
    await recordFindings([makeFinding()], root);
    const index = await loadIndex(root);
    const patternId = index.entries[0]!.pattern_id;

    const { unlink } = await import('node:fs/promises');
    await unlink(path.join(root, 'entries', `${patternId}.json`));

    await expect(
      recordFindings([makeFinding({ description: 'repeat finding after missing entry' })], root),
    ).resolves.toBeUndefined();

    const after = await loadIndex(root);
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0]!.frequency).toBe(1);
  });
});

describe('markStaleEntries', () => {
  it('marks entries older than 365 days as stale (FR-DP3-T4)', () => {
    const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const index = {
      schema_version: 1,
      updated_at: new Date().toISOString(),
      entries: [
        {
          pattern_id: 'p1',
          subcategory: 'D5.missing-boundary',
          frequency: 3,
          last_seen: oldDate,
          stale: false,
        },
      ],
    };
    markStaleEntries(index);
    expect(index.entries[0]!.stale).toBe(true);
  });

  it('does not mark recent entries as stale', () => {
    const index = {
      schema_version: 1,
      updated_at: new Date().toISOString(),
      entries: [
        {
          pattern_id: 'p1',
          subcategory: 'D5.missing-boundary',
          frequency: 3,
          last_seen: new Date().toISOString(),
          stale: false,
        },
      ],
    };
    markStaleEntries(index);
    expect(index.entries[0]!.stale).toBe(false);
  });
});
