// Edge-branch coverage for the Discovery module (issue #597): the defensive/rarely-taken paths the
// happy-path suites do not exercise, kept in one place so the intent of each is explicit.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { foldDiscoveryRun } from '@/discovery/fold.js';
import { mintDiscoveryRunDirName } from '@/discovery/mint.js';
import { discoveryRunFilePath } from '@/discovery/paths.js';
import { recordDiscoveryStage } from '@/discovery/recorder.js';
import { openDiscoveryRun, readDiscoveryRun } from '@/discovery/run-store.js';
import { validateDiscoveryArtifact } from '@/discovery/validate.js';
import { writeBrief } from '@/discovery/writers.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-discovery-edge-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const ULID = '01M3RWNS7194V0PV2RX340VM50';

describe('mint edge branches', () => {
  it('normalises a ref that empties to null (a lone #)', () => {
    expect(mintDiscoveryRunDirName({ title: 'idea', issue: '#', ulid: ULID }).issue).toBeNull();
  });
});

describe('fold time-merge edge branches', () => {
  function stageRow(kind: string, at: string | null): SessionLedgerRow {
    const base: Record<string, unknown> = {
      schema_version: 1,
      doc_type: 'paqad.discovery-evidence',
      session_id: 's',
      content_hash: 'x',
      kind,
      stage: 'understand',
    };
    if (at !== null) base.ts = at;
    return base as SessionLedgerRow;
  }

  it('keeps the earlier start when a later start row carries no time (minTime b===null)', () => {
    const folded = foldDiscoveryRun([
      stageRow('stage_start', '2026-09-30T10:00:00.000Z'),
      stageRow('stage_start', null),
    ]);
    expect(folded.stages[0]!.startedAt).toBe('2026-09-30T10:00:00.000Z');
  });

  it('keeps the later end when a second end row carries no time (maxTime b===null)', () => {
    const folded = foldDiscoveryRun([
      stageRow('stage_end', '2026-09-30T10:05:00.000Z'),
      stageRow('stage_end', null),
    ]);
    expect(folded.stages[0]!.endedAt).toBe('2026-09-30T10:05:00.000Z');
  });

  it('picks the earliest start and latest end across out-of-order rows (both ternary sides)', () => {
    const folded = foldDiscoveryRun([
      stageRow('stage_start', '2026-09-30T10:02:00.000Z'),
      stageRow('stage_start', '2026-09-30T10:01:00.000Z'), // earlier than the first
      stageRow('stage_start', '2026-09-30T10:03:00.000Z'), // later than the running min
      stageRow('stage_end', '2026-09-30T10:08:00.000Z'),
      stageRow('stage_end', '2026-09-30T10:09:00.000Z'), // later than the first end
      stageRow('stage_end', '2026-09-30T10:07:00.000Z'), // earlier than the running max
    ]);
    expect(folded.stages[0]!.startedAt).toBe('2026-09-30T10:01:00.000Z');
    expect(folded.stages[0]!.endedAt).toBe('2026-09-30T10:09:00.000Z');
  });
});

describe('run-store non-object run.json', () => {
  it('reads null when run.json parses to a non-object', () => {
    const root = tempRoot();
    const { dirName } = openDiscoveryRun(root, { sessionId: 's', title: 'idea', adapter: 'x' });
    writeFileSync(join(root, discoveryRunFilePath(dirName, 'run')), '42', 'utf8');
    expect(readDiscoveryRun(root, dirName)).toBeNull();
    writeFileSync(join(root, discoveryRunFilePath(dirName, 'run')), 'null', 'utf8');
    expect(readDiscoveryRun(root, dirName)).toBeNull();
  });
});

describe('validate owner-unknown path', () => {
  it('fails closed when the run has no run.json owner (m4: ownership cannot be established)', () => {
    const root = tempRoot();
    const { dirName } = openDiscoveryRun(root, {
      sessionId: 'sess-A',
      title: 'idea',
      adapter: 'x',
    });
    writeBrief(
      { projectRoot: root, dirName, sessionId: 'sess-A' },
      {
        revision: 1,
        intent: 'i',
        facts: [],
        interpretations: [],
        success: [],
        constraints: [],
        open_questions: [],
        assignments: [],
      },
    );
    // Remove run.json so the owner cannot be established; the gate must fail closed.
    rmSync(join(root, discoveryRunFilePath(dirName, 'run')));
    const res = validateDiscoveryArtifact(
      root,
      dirName,
      'sess-A',
      discoveryRunFilePath(dirName, 'brief'),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('foreign-owner');
    expect(res.detail).toMatch(/cannot be established/);
  });
});

describe('recorder end without an artifact path', () => {
  it('records a null artifact_path/digest when an end carries no artifact', () => {
    const root = tempRoot();
    const { dirName } = openDiscoveryRun(root, { sessionId: 's', title: 'idea', adapter: 'x' });
    const row = recordDiscoveryStage(root, dirName, {
      sessionId: 's',
      stage: 'hand_off',
      phase: 'end',
      revision: 1,
    });
    expect(row!.artifact_path).toBeNull();
    expect(row!.artifact_digest).toBeNull();
  });
});
