import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  changeKey,
  endStage,
  foldChange,
  isMandatoryStage,
  openStageEvidence,
  STAGE_EVIDENCE_DOC_TYPE,
  STAGE_EVIDENCE_STAGES,
  startStage,
  validateStageEvidenceRow,
  verifyChange,
} from '@/stage-evidence/index.js';
import { readSessionDoc } from '@/session-ledger/ledger.js';

/** A clock that advances `stepMs` on each call, for deterministic durations. */
function clock(startMs = 1_000_000, stepMs = 1000): () => Date {
  let t = startMs - stepMs;
  return () => {
    t += stepMs;
    return new Date(t);
  };
}

const ADAPTER = 'claude-code';

describe('stage-evidence ledger (#247)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-stage-ev-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function run(stages: string[], now: () => Date, sessionId = 'ses_test'): number {
    const { ordinal } = openStageEvidence(root, { sessionId, adapter: ADAPTER, now });
    for (const stage of stages) {
      startStage(root, stage, { sessionId, ordinal, adapter: ADAPTER, now });
      endStage(root, stage, {}, { sessionId, ordinal, adapter: ADAPTER, now });
    }
    return ordinal;
  }

  const MANDATORY = STAGE_EVIDENCE_STAGES.filter(isMandatoryStage);

  it('opens a per-change record keyed by session + prompt ordinal', () => {
    const a = openStageEvidence(root, { sessionId: 'ses_x', adapter: ADAPTER });
    const b = openStageEvidence(root, { sessionId: 'ses_x', adapter: ADAPTER });
    // One session, many changes: each gets the next ordinal.
    expect(a.ordinal).toBe(1);
    expect(b.ordinal).toBe(2);
    expect(a.changeKey).toBe(changeKey('ses_x', 1));
    expect(b.changeKey).toBe('ses_x#2');
  });

  it('stamps a script-clock start and end datetime and derives duration_ms per stage', () => {
    const ordinal = run(['planning', 'specification'], clock(0, 5000), 'ses_t');
    const fold = foldChange(root, 'ses_t', ordinal);
    const planning = fold.stages.find((s) => s.stage === 'planning')!;
    expect(planning.started_at).not.toBeNull();
    expect(planning.ended_at).not.toBeNull();
    // start at t=5000 (after open at 0), end at t=10000 → 5000ms.
    expect(planning.duration_ms).toBe(5000);
    expect(planning.duration_unreliable).toBe(false);
  });

  it('records stages in order; an out-of-order start is rejected', () => {
    const now = clock();
    const { ordinal } = openStageEvidence(root, { sessionId: 'ses_o', adapter: ADAPTER, now });
    startStage(root, 'development', { sessionId: 'ses_o', ordinal, adapter: ADAPTER, now });
    // planning is earlier than development → starting it now is out of order.
    expect(() =>
      startStage(root, 'planning', { sessionId: 'ses_o', ordinal, adapter: ADAPTER, now }),
    ).toThrow(/out-of-order/i);
  });

  it('rejects an unknown stage', () => {
    expect(() => startStage(root, 'not-a-stage', { sessionId: 'ses_u', adapter: ADAPTER })).toThrow(
      /unknown stage/i,
    );
  });

  it('verify passes (exit 0) when every mandatory stage ran in order', () => {
    const ordinal = run([...MANDATORY], clock(), 'ses_ok');
    const result = verifyChange(root, { sessionId: 'ses_ok', ordinal, adapter: ADAPTER });
    expect(result.verdict).toBe('complete');
    expect(result.ok).toBe(true);
    expect(result.missing_stages).toEqual([]);
  });

  it('verify fails (incomplete) and lists the missing mandatory stage', () => {
    const partial = MANDATORY.filter((s) => s !== 'documentation_sync');
    const ordinal = run([...partial], clock(), 'ses_miss');
    const result = verifyChange(root, { sessionId: 'ses_miss', ordinal, adapter: ADAPTER });
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('incomplete');
    expect(result.missing_stages).toContain('documentation_sync');
  });

  it('escalates to blocked once the redo cap is hit', () => {
    const partial = MANDATORY.filter((s) => s !== 'review');
    const ordinal = run([...partial], clock(), 'ses_block');
    const ctx = { sessionId: 'ses_block', ordinal, adapter: ADAPTER };
    expect(verifyChange(root, ctx).verdict).toBe('incomplete'); // attempt 1
    expect(verifyChange(root, ctx).verdict).toBe('incomplete'); // attempt 2
    const third = verifyChange(root, ctx); // cap hit
    expect(third.verdict).toBe('blocked');
    expect(third.blocked).toBe(true);
  });

  it('flags an ordering violation when a later stage overlaps an earlier one', () => {
    // Hand-build overlapping events: development starts before specification ends.
    const sessionId = 'ses_overlap';
    const { ordinal } = openStageEvidence(root, { sessionId, adapter: ADAPTER });
    const c = (stage: string, kind: 'stage_start' | 'stage_end', t: number) =>
      startStageRaw(root, sessionId, ordinal, stage, kind, t);
    c('specification', 'stage_start', 1);
    c('development', 'stage_start', 2); // dev starts...
    c('specification', 'stage_end', 3); // ...before spec ends → violation
    c('development', 'stage_end', 4);
    const fold = foldChange(root, sessionId, ordinal);
    expect(fold.completeness.ordering_violations).toContainEqual({
      before: 'specification',
      after: 'development',
    });
  });

  it('hashes a real artifact over its on-disk bytes', () => {
    const sessionId = 'ses_art';
    writeFileSync(join(root, 'spec.md'), '# spec body');
    const { ordinal } = openStageEvidence(root, { sessionId, adapter: ADAPTER });
    startStage(root, 'planning', { sessionId, ordinal, adapter: ADAPTER });
    const row = endStage(
      root,
      'planning',
      { artifactPaths: ['spec.md'] },
      { sessionId, ordinal, adapter: ADAPTER },
    );
    expect(row.artifact_digest).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(row.artifact_paths).toEqual(['spec.md']);
  });

  it('writes only AJV-valid rows to disk', () => {
    run(['planning'], clock(), 'ses_valid');
    const rows = readSessionDoc(root, STAGE_EVIDENCE_DOC_TYPE, 'ses_valid');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(validateStageEvidenceRow(row)).toEqual([]);
    }
  });

  it('persists the ledger as JSONL under .paqad/ledger/<doc>/<session>/<ordinal>.jsonl', () => {
    const ordinal = run(['planning'], clock(), 'ses_path');
    const file = join(
      root,
      '.paqad/ledger',
      STAGE_EVIDENCE_DOC_TYPE,
      'ses_path',
      `${ordinal}.jsonl`,
    );
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3); // open + start + end
    expect(JSON.parse(lines[0]).kind).toBe('open');
  });
});

/** Append a raw stage_start/stage_end with a fixed clock instant (for overlap tests). */
function startStageRaw(
  root: string,
  sessionId: string,
  ordinal: number,
  stage: string,
  kind: 'stage_start' | 'stage_end',
  t: number,
): void {
  if (kind === 'stage_start') {
    startStage(root, stage, {
      sessionId,
      ordinal,
      adapter: 'claude-code',
      now: () => new Date(t),
    });
  } else {
    endStage(
      root,
      stage,
      {},
      { sessionId, ordinal, adapter: 'claude-code', now: () => new Date(t) },
    );
  }
}
