import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  classifyStage,
  recordLiveStageEdit,
  recordMarkedStage,
} from '@/stage-evidence/live-writer.js';
import { stageIndex } from '@/stage-evidence/stages.js';
import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { type SessionLedgerRow } from '@/session-ledger/ledger.js';

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
    const dir = currentFeature(root, SES);
    return dir ? readFeatureStageUnit(root, dir) : [];
  }
  const kinds = (kind: string, stage?: string) =>
    rows().filter((r) => r.kind === kind && (stage ? r.stage === stage : true));

  /** Record the pre-code stages (planning + specification) so the writer's #310 defer
   *  is satisfied and a following code edit records its stage. Mirrors the real flow:
   *  planning/specification are marked (markers / CLI) before any code is written. */
  function seedPreCode(now?: () => Date): void {
    recordMarkedStage(root, { sessionId: SES, stage: 'planning', phase: 'start', now });
    recordMarkedStage(root, { sessionId: SES, stage: 'planning', phase: 'end', now });
    recordMarkedStage(root, { sessionId: SES, stage: 'specification', phase: 'start', now });
    recordMarkedStage(root, { sessionId: SES, stage: 'specification', phase: 'end', now });
  }

  it('#310: a code edit records NOTHING until the pre-code stages are on the ledger', () => {
    const stage = recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Edit',
      targetPath: 'src/foo.ts',
      now: clock(),
    });
    // No planning/specification yet → the writer defers, opening no change and
    // recording no row (stamping "development" before planning poisons ordering).
    expect(stage).toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it('AC-1: opens a change and starts development with a script-stamped live-mark', () => {
    const now = clock();
    seedPreCode(now);
    const stage = recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Edit',
      targetPath: 'src/foo.ts',
      now,
    });
    expect(stage).toBe('development');
    const start = kinds('stage_start', 'development');
    expect(start).toHaveLength(1);
    expect(start[0]?.evidence_source).toBe('live-mark');
    expect(typeof start[0]?.ts).toBe('string');
  });

  it('AC-2: a later stage boundary ends the earlier stage (ended_at) then starts the new one', () => {
    const now = clock();
    seedPreCode(now);
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
    seedPreCode(now);
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
    seedPreCode(now);
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
    seedPreCode(clock());
    const stage = recordLiveStageEdit({
      projectRoot: root,
      sessionId: SES,
      toolName: 'Edit',
      targetPath: 'pnpm-lock.yaml',
      now: clock(),
    });
    expect(stage).toBeNull();
    // Only the seeded pre-code rows exist; the lockfile edit added nothing.
    expect(kinds('stage_start', 'development')).toHaveLength(0);
    expect(kinds('stage_start', 'checks')).toHaveLength(0);
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
    const dir = currentFeature(root, SES)!;
    const rows = readFeatureStageUnit(root, dir);
    expect(
      rows.find((r) => r.kind === 'stage_start' && r.stage === 'planning')?.evidence_source,
    ).toBe('live-mark');
    expect(rows.some((r) => r.kind === 'stage_end' && r.stage === 'planning')).toBe(true);
  });

  it('ignores an unknown stage token (no row, returns false)', () => {
    expect(recordMarkedStage(root, { sessionId: SES, stage: 'bogus', phase: 'start' })).toBe(false);
    expect(currentFeature(root, SES)).toBeNull();
  });

  it('a titled start opens a fresh named feature (issue #339 new-work signal)', () => {
    // No title → an untitled `change-<ULID>` feature.
    recordMarkedStage(root, { sessionId: SES, stage: 'planning', phase: 'start' });
    const first = currentFeature(root, SES)!;
    expect(first.startsWith('change-')).toBe(true);
    // A titled start opens a DISTINCT named feature (the prior one is paused).
    expect(
      recordMarkedStage(root, {
        sessionId: SES,
        stage: 'planning',
        phase: 'start',
        title: 'Route first workflows',
        issue: '339',
      }),
    ).toBe(true);
    const second = currentFeature(root, SES)!;
    expect(second).not.toBe(first);
    expect(second.startsWith('339-route-first-workflows-')).toBe(true);
  });

  it('a title on an END is ignored (attaches to the active change, no new feature)', () => {
    recordMarkedStage(root, { sessionId: SES, stage: 'planning', phase: 'start' });
    const active = currentFeature(root, SES)!;
    recordMarkedStage(root, {
      sessionId: SES,
      stage: 'planning',
      phase: 'end',
      title: 'ignored on end',
      issue: null,
    });
    // Still the same feature — an end never opens new work.
    expect(currentFeature(root, SES)).toBe(active);
  });

  it('returns false (never throws) when the ledger write itself fails', () => {
    // A KNOWN stage passes the registry guard and enters the record path, but the
    // ledger append throws because the project root is a FILE, not a directory
    // (ENOTDIR). recordMarkedStage must swallow it and report false — a junk marker
    // can never crash the pre-mutation sweep or the Stop re-parse.
    const fileRoot = join(tmpdir(), `paqad-marked-file-${SES}-${process.pid}`);
    writeFileSync(fileRoot, 'not a directory');
    expect(recordMarkedStage(fileRoot, { sessionId: SES, stage: 'planning', phase: 'start' })).toBe(
      false,
    );
    expect(recordMarkedStage(fileRoot, { sessionId: SES, stage: 'planning', phase: 'end' })).toBe(
      false,
    );
    rmSync(fileRoot, { force: true });
  });
});
