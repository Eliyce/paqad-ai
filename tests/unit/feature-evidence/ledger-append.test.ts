import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { bundleLockPath } from '@/feature-evidence/ledger-append.js';
import { checkStageChain } from '@/feature-evidence/ledger-chain.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import { strayBundleFiles } from '@/feature-evidence/bundle-integrity.js';
import { backfillFeatureSlug } from '@/feature-evidence/rename.js';
import { appendFeatureStageRow } from '@/feature-evidence/stage-ledger.js';
import { computeSessionRowHash } from '@/session-ledger/ledger.js';

const DIR = 'ledger-test-01JABCDEFGHJKMNPQRSTVWXYZ0';
const SESSION = 'ses_ledger';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-ledger-append-'));
  roots.push(root);
  mkdirSync(join(root, featureDir(DIR)), { recursive: true });
  return root;
}

function ledgerPath(root: string): string {
  return join(root, featureFilePath(DIR, 'stageEvidence'));
}

function rows(root: string): Array<Record<string, unknown>> {
  return readFileSync(ledgerPath(root), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const at = (ms: number) => () => new Date(1_700_000_000_000 + ms);

function append(root: string, row: Record<string, unknown>, now = at(0)) {
  return appendFeatureStageRow(root, SESSION, DIR, row, now);
}

describe('the locked stage ledger append', () => {
  it('AC-80: chains each row to the last, with the chain inside the hash', () => {
    const root = tempRoot();
    append(root, { kind: 'open' });
    append(root, { kind: 'stage_start', stage: 'planning' });
    const [first, second] = rows(root);
    expect(first).toMatchObject({ schema_version: 3, prev_hash: null });
    expect(second!.prev_hash).toBe(first!.content_hash);
    expect(computeSessionRowHash(second!)).toBe(second!.content_hash);
    expect(computeSessionRowHash({ ...second!, prev_hash: 'other' })).not.toBe(
      second!.content_hash,
    );
    expect(existsSync(bundleLockPath(root, DIR))).toBe(false);
  });

  it('builds the key from the change, the agent, the stage, the kind, the status and an id', () => {
    const root = tempRoot();
    append(root, {
      kind: 'stage-handback',
      stage: 'planning',
      agent_id: 'a1',
      event_status: 'denied',
      tool_use_id: 'toolu_1',
    });
    expect(rows(root)[0]!.idempotency_key).toBe(
      '01JABCDEFGHJKMNPQRSTVWXYZ0:a1:planning:stage-handback:denied:toolu_1',
    );
  });

  it('AC-40: keeps a second review round started outside the window', () => {
    const root = tempRoot();
    const row = { kind: 'stage_start', stage: 'review' };
    append(root, row, at(0));
    append(root, { kind: 'stage_end', stage: 'review' }, at(1_000));
    append(root, row, at(60_000));
    append(root, { kind: 'stage_end', stage: 'review' }, at(61_000));
    expect(rows(root).map((entry) => entry.kind)).toEqual([
      'stage_start',
      'stage_end',
      'stage_start',
      'stage_end',
    ]);
  });

  it('AC-34, AC-40: drops a repeat of one row inside the window, keeps both outside it', () => {
    const root = tempRoot();
    const row = { kind: 'stage_end', stage: 'planning' };
    append(root, row, at(0));
    append(root, row, at(9_999));
    expect(rows(root)).toHaveLength(1);
    append(root, row, at(10_000));
    expect(rows(root)).toHaveLength(1);
    append(root, row, at(10_001));
    expect(rows(root)).toHaveLength(2);
  });

  it('ignores the stamps and the host pid when two routes write one event', () => {
    const root = tempRoot();
    const row = { kind: 'stage-agent', stage: 'review', agent_id: 'a1', event_status: 'started' };
    const tokens = { tokens_used: 0, tokens_not_recarried: 0, estimate: true };
    append(root, { ...row, ...tokens, host_pid: 1 }, at(0));
    append(root, { ...row, ...tokens, host_pid: 2, note: 'other route' }, at(5));
    expect(rows(root)).toHaveLength(1);
  });

  it('compares a key ending in an id by value, at any age', () => {
    const root = tempRoot();
    const refusal = (id: string) => ({
      kind: 'stage-handback',
      stage: 'planning',
      agent_id: 'a1',
      event_status: 'denied',
      tool_use_id: id,
    });
    append(root, refusal('t1'), at(0));
    append(root, refusal('t2'), at(1));
    append(root, refusal('t1'), at(100_000));
    expect(rows(root)).toHaveLength(2);
  });

  it('AC-35, AC-41: keeps twenty parallel appends from separate processes, chained or with gaps declared', async () => {
    const root = tempRoot();
    const script = `
      import { appendFeatureStageRow } from ${JSON.stringify(join(process.cwd(), 'dist/feature-evidence/stage-ledger.js'))};
      appendFeatureStageRow(process.argv[2], 'ses_ledger', ${JSON.stringify(DIR)}, { kind: 'stage_start', stage: 'planning', note: null, agent_id: 'p' + process.argv[3] });
    `;
    const file = join(root, 'append.mjs');
    writeFileSync(file, script);
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => execa('node', [file, root, String(index)])),
    );
    const written = rows(root);
    expect(written).toHaveLength(20);
    expect(checkStageChain(readFileSync(ledgerPath(root), 'utf8')).breaks).toEqual([]);
  }, 60_000);

  it('AC-41: reclaims a lock left by a dead holder and chains normally', () => {
    const root = tempRoot();
    append(root, { kind: 'open' });
    const lock = bundleLockPath(root, DIR);
    mkdirSync(lock);
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    append(root, { kind: 'stage_start', stage: 'planning' });
    const written = rows(root);
    expect(written[1]!.chain_note).toBeUndefined();
    expect(written[1]!.prev_hash).toBe(written[0]!.content_hash);
  });

  it('AC-41: appends with a declared gap when the lock stays held, and still does not duplicate', () => {
    const root = tempRoot();
    append(root, { kind: 'open' });
    mkdirSync(bundleLockPath(root, DIR));
    const row = { kind: 'stage_start', stage: 'planning' };
    append(root, row);
    append(root, row);
    const written = rows(root);
    expect(written).toHaveLength(2);
    expect(written[1]).toMatchObject({ prev_hash: null, chain_note: 'lock-timeout' });
  });

  it('AC-42: starts on a fresh line after a torn tail and chains to the last readable row', () => {
    const root = tempRoot();
    append(root, { kind: 'open' });
    const first = rows(root)[0]!;
    writeFileSync(ledgerPath(root), `${readFileSync(ledgerPath(root), 'utf8')}{"cut":`);
    append(root, { kind: 'stage_start', stage: 'planning' });
    const lines = readFileSync(ledgerPath(root), 'utf8').split('\n');
    expect(lines[1]).toBe('{"cut":');
    const row = JSON.parse(lines[2]!) as Record<string, unknown>;
    expect(row).toMatchObject({ prev_hash: first.content_hash, chain_note: 'after-torn-line' });
  });

  it('exempts the lock from the stray bundle file check', () => {
    const root = tempRoot();
    append(root, { kind: 'open' });
    mkdirSync(bundleLockPath(root, DIR));
    expect(strayBundleFiles(root, DIR)).not.toContain('.lock');
  });

  it('still refuses a row the schema rejects', () => {
    const root = tempRoot();
    expect(() => append(root, { kind: 'not-a-kind' })).toThrow(/Invalid/);
    expect(existsSync(bundleLockPath(root, DIR))).toBe(false);
  });
});

describe('renaming a bundle mid-change', () => {
  const UNTITLED = 'change-01JABCDEFGHJKMNPQRSTVWXYZ1';
  const TITLED = '12-a-real-title-01JABCDEFGHJKMNPQRSTVWXYZ1';

  function untitledRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'paqad-ledger-rename-'));
    roots.push(root);
    mkdirSync(join(root, featureDir(UNTITLED)), { recursive: true });
    return root;
  }

  function rowsOf(root: string, dirName: string): Array<Record<string, unknown>> {
    return readFileSync(join(root, featureFilePath(dirName, 'stageEvidence')), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  function seeded(root: string): void {
    const artifact = join(featureDir(UNTITLED), 'plan.json');
    appendFeatureStageRow(root, SESSION, UNTITLED, { kind: 'open' }, at(0));
    appendFeatureStageRow(
      root,
      SESSION,
      UNTITLED,
      { kind: 'stage_end', stage: 'planning', artifact_paths: [artifact] },
      at(1),
    );
    appendFeatureStageRow(root, SESSION, UNTITLED, { kind: 'stage_start', stage: 'review' }, at(2));
    appendFeatureStageRow(root, SESSION, UNTITLED, { kind: 'stage_end', stage: 'review' }, at(3));
  }

  it('AC-44 and AC-81: relinks every later row in order, with only the paths and hashes changed', () => {
    const root = untitledRoot();
    seeded(root);
    const before = rowsOf(root, UNTITLED);
    const result = backfillFeatureSlug(root, UNTITLED, 'a real title', at(4), '12');
    expect(result).toEqual({ dirName: TITLED, renamed: true });
    const after = rowsOf(root, TITLED);
    expect(
      checkStageChain(readFileSync(join(root, featureFilePath(TITLED, 'stageEvidence')), 'utf8'))
        .breaks,
    ).toEqual([]);
    expect(after[2]!.prev_hash).toBe(after[1]!.content_hash);
    expect(after[3]!.prev_hash).toBe(after[2]!.content_hash);
    after.forEach((row, index) => {
      expect(computeSessionRowHash(row)).toBe(row.content_hash);
      const changed = Object.keys(row).filter(
        (key) => JSON.stringify(row[key]) !== JSON.stringify(before[index]![key]),
      );
      for (const key of changed) {
        expect(['artifact_paths', 'content_hash', 'prev_hash']).toContain(key);
      }
    });
    expect(existsSync(bundleLockPath(root, TITLED))).toBe(false);
  });

  it('AC-44: still dedupes a row re-sent after the rename', () => {
    const root = untitledRoot();
    seeded(root);
    backfillFeatureSlug(root, UNTITLED, 'a real title', at(4), '12');
    const count = rowsOf(root, TITLED).length;
    appendFeatureStageRow(root, SESSION, TITLED, { kind: 'stage_end', stage: 'review' }, at(5));
    expect(rowsOf(root, TITLED)).toHaveLength(count);
  });

  it('AC-44: still dedupes a re-sent end row whose artifact path moved with the rename', () => {
    const root = untitledRoot();
    const path = (dir: string) => join(featureFilePath(dir, 'stageEvidence'), '..', 'review.json');
    appendFeatureStageRow(
      root,
      SESSION,
      UNTITLED,
      {
        kind: 'stage_end',
        stage: 'review',
        artifact_paths: [path(UNTITLED)],
        artifact_digest: 'd',
      },
      at(1),
    );
    backfillFeatureSlug(root, UNTITLED, 'a real title', at(2), '12');
    const count = rowsOf(root, TITLED).length;
    appendFeatureStageRow(
      root,
      SESSION,
      TITLED,
      { kind: 'stage_end', stage: 'review', artifact_paths: [path(TITLED)], artifact_digest: 'd' },
      at(3),
    );
    expect(rowsOf(root, TITLED)).toHaveLength(count);
  });

  it('relinks a row that chained past a declared gap, and releases only a lock it took', () => {
    const root = untitledRoot();
    seeded(root);
    const ledger = join(root, featureFilePath(UNTITLED, 'stageEvidence'));
    const lock = bundleLockPath(root, UNTITLED);
    mkdirSync(lock);
    appendFeatureStageRow(root, SESSION, UNTITLED, { kind: 'stage_start', stage: 'checks' }, at(3));
    rmSync(lock, { recursive: true });
    appendFeatureStageRow(root, SESSION, UNTITLED, { kind: 'stage_end', stage: 'checks' }, at(3));
    expect(readFileSync(ledger, 'utf8')).toContain('lock-timeout');
    backfillFeatureSlug(root, UNTITLED, 'a real title', at(4), '12');
    const renamed = readFileSync(join(root, featureFilePath(TITLED, 'stageEvidence')), 'utf8');
    expect(checkStageChain(renamed).breaks).toEqual([]);
  });

  it('leaves a lock another writer holds in place when the rename times out on it', () => {
    const root = untitledRoot();
    seeded(root);
    const lock = bundleLockPath(root, UNTITLED);
    mkdirSync(lock);
    backfillFeatureSlug(root, UNTITLED, 'a real title', at(4), '12');
    expect(existsSync(bundleLockPath(root, TITLED))).toBe(true);
  });

  it('AC-82: keeps every row and a clean chain when hooks append during the rename', async () => {
    const root = untitledRoot();
    seeded(root);
    const file = join(root, 'append.mjs');
    writeFileSync(
      file,
      `
      import { appendFeatureStageRow } from ${JSON.stringify(join(process.cwd(), 'dist/feature-evidence/stage-ledger.js'))};
      appendFeatureStageRow(process.argv[2], ${JSON.stringify(SESSION)}, ${JSON.stringify(UNTITLED)}, { kind: 'stage_start', stage: 'checks', note: null, agent_id: 'p' + process.argv[3] });
    `,
    );
    const hooks = Array.from({ length: 8 }, (_, index) =>
      execa('node', [file, root, String(index)]),
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(backfillFeatureSlug(root, UNTITLED, 'a real title', undefined, '12').dirName).toBe(
      TITLED,
    );
    await Promise.all(hooks);
    expect(existsSync(join(root, featureDir(UNTITLED)))).toBe(false);
    expect(rowsOf(root, TITLED)).toHaveLength(12);
    const ledger = readFileSync(join(root, featureFilePath(TITLED, 'stageEvidence')), 'utf8');
    expect(checkStageChain(ledger).breaks).toEqual([]);
  }, 60_000);

  it('AC-82: lands a late append in the new folder and does not recreate the old name', () => {
    const root = untitledRoot();
    seeded(root);
    backfillFeatureSlug(root, UNTITLED, 'a real title', at(4), '12');
    appendFeatureStageRow(root, SESSION, UNTITLED, { kind: 'stage_start', stage: 'checks' }, at(6));
    expect(existsSync(join(root, featureDir(UNTITLED)))).toBe(false);
    const after = rowsOf(root, TITLED);
    expect(after.at(-1)).toMatchObject({ kind: 'stage_start', stage: 'checks' });
    expect(
      checkStageChain(readFileSync(join(root, featureFilePath(TITLED, 'stageEvidence')), 'utf8'))
        .breaks,
    ).toEqual([]);
  });
});
