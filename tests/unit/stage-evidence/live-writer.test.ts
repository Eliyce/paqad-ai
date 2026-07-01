import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  classifyStage,
  recordLiveStageEdit,
  recordMarkedStage,
} from '@/stage-evidence/live-writer.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';
import { stageIndex } from '@/stage-evidence/stages.js';
import { currentOrdinal, readSessionUnit, type SessionLedgerRow } from '@/session-ledger/ledger.js';

function clock(startMs = 1_000_000, stepMs = 1000): () => Date {
  let t = startMs - stepMs;
  return () => ((t += stepMs), new Date(t));
}

describe('classifyStage — mutated file → stage (RCA fix A)', () => {
  const cases: Array<[string, string | null]> = [
    ['src/foo.ts', 'development'],
    ['src/stage-evidence/live-writer.ts', 'development'],
    ['runtime/hooks/x.mjs', 'development'],
    ['scripts/build.ts', 'development'],
    ['tests/unit/foo.test.ts', 'checks'],
    ['src/foo.test.ts', 'checks'], // a src test is `checks`, not development
    ['src/__tests__/x.ts', 'checks'],
    ['docs/instructions/rules/x.md', 'specification'], // canonical contract
    ['specs/feature.md', 'specification'],
    ['docs/modules/x/summary.md', 'documentation_sync'],
    ['README.md', 'documentation_sync'],
    ['CHANGELOG.md', 'documentation_sync'],
    ['notes.md', 'documentation_sync'], // top-level doc
    ['.paqad/ledger/x.jsonl', null], // never records itself
    ['pnpm-lock.yaml', null],
    ['package.json', null],
  ];
  for (const [path, expected] of cases) {
    it(`${path} → ${expected}`, () => {
      expect(classifyStage(path, '')).toBe(expected);
    });
  }

  it('normalises an absolute host path against the project root', () => {
    expect(classifyStage('/tmp/proj/src/a.ts', '/tmp/proj')).toBe('development');
    expect(classifyStage('/tmp/proj/tests/a.test.ts', '/tmp/proj')).toBe('checks');
  });
});

describe('recordLiveStageEdit — deterministic per-stage writer', () => {
  let root: string;
  const SES = 'ses_live';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-live-writer-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function rows(): SessionLedgerRow[] {
    const ord = currentOrdinal(root, STAGE_EVIDENCE_DOC_TYPE, SES);
    return ord > 0 ? readSessionUnit(root, STAGE_EVIDENCE_DOC_TYPE, SES, ord) : [];
  }
  const kinds = (kind: string, stage?: string) =>
    rows().filter((r) => r.kind === kind && (stage ? r.stage === stage : true));

  it('AC-1: opens a change and starts development with a script-stamped live-mark', () => {
    const stage = recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Edit',
      targetPath: 'src/foo.ts',
      now: clock(),
    });
    expect(stage).toBe('development');
    const start = kinds('stage_start', 'development');
    expect(start).toHaveLength(1);
    expect(start[0]?.evidence_source).toBe('live-mark');
    expect(typeof start[0]?.ts).toBe('string');
  });

  it('AC-2: a later stage boundary ends the earlier stage (ended_at) then starts the new one', () => {
    const now = clock();
    recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Edit',
      targetPath: 'src/foo.ts',
      now,
    });
    recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Write',
      targetPath: 'tests/foo.test.ts',
      now,
    });

    expect(kinds('stage_end', 'development')).toHaveLength(1);
    expect(kinds('stage_start', 'checks')).toHaveLength(1);
    expect(kinds('stage_end', 'development')[0]?.ts).toBeTruthy();
    expect(stageIndex('development')).toBeLessThan(stageIndex('checks'));
  });

  it('is idempotent within a stage: two development edits yield one stage_start', () => {
    const now = clock();
    recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Edit',
      targetPath: 'src/a.ts',
      now,
    });
    recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Edit',
      targetPath: 'src/b.ts',
      now,
    });
    expect(kinds('stage_start', 'development')).toHaveLength(1);
  });

  it('AC-4: an out-of-order edit records nothing and never throws', () => {
    const now = clock();
    recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Write',
      targetPath: 'tests/foo.test.ts',
      now,
    }); // checks
    const stage = recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Edit',
      targetPath: 'src/foo.ts',
      now,
    }); // development < checks
    expect(stage).toBeNull();
    expect(kinds('stage_start', 'development')).toHaveLength(0);
  });

  it('a non-stage-bearing edit (lockfile) records nothing', () => {
    const stage = recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Edit',
      targetPath: 'pnpm-lock.yaml',
      now: clock(),
    });
    expect(stage).toBeNull();
    expect(rows()).toHaveLength(0);
  });
});

describe('recordMarkedStage — the shared marker seam (non-mutation stages)', () => {
  let root: string;
  const SES = 'ses_mark';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-marked-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('records a script-minted start then end for a marked stage', () => {
    const now = clock();
    expect(
      recordMarkedStage(root, { sessionId: SES, stage: 'planning', phase: 'start', now }),
    ).toBe(true);
    expect(recordMarkedStage(root, { sessionId: SES, stage: 'planning', phase: 'end', now })).toBe(
      true,
    );
    const ord = currentOrdinal(root, STAGE_EVIDENCE_DOC_TYPE, SES);
    const rows = readSessionUnit(root, STAGE_EVIDENCE_DOC_TYPE, SES, ord);
    expect(
      rows.find((r) => r.kind === 'stage_start' && r.stage === 'planning')?.evidence_source,
    ).toBe('live-mark');
    expect(rows.some((r) => r.kind === 'stage_end' && r.stage === 'planning')).toBe(true);
  });

  it('ignores an unknown stage token (no row, returns false)', () => {
    expect(recordMarkedStage(root, { sessionId: SES, stage: 'bogus', phase: 'start' })).toBe(false);
    expect(currentOrdinal(root, STAGE_EVIDENCE_DOC_TYPE, SES)).toBe(0);
  });
});
