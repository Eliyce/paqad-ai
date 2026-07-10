import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  COMPLETION_ANCHORED_STAGES,
  endStage,
  foldRowsWithKey,
  isArtifactBearingStage,
  isCompletionAnchoredStage,
  isMandatoryStage,
  openStageEvidence,
  STAGE_EVIDENCE_DOC_TYPE,
  STAGE_EVIDENCE_STAGES,
  startStage,
  validateStageEvidenceRow,
  verifyChange,
  type EndStageInput,
} from '@/stage-evidence/index.js';
import {
  currentFeature,
  featureStagePath,
  foldFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { type SessionLedgerRow } from '@/session-ledger/ledger.js';

/**
 * The stage-evidence store is re-keyed onto the per-feature bundle (issue #339): a
 * change's rows live in `<feature-dir>/stage-evidence.jsonl`, resolved from the active
 * feature in the `_session` control, not `<session>/<ordinal>.jsonl`. These helpers fold
 * a feature's rows and read them back for the disk-based assertions.
 */
function foldRows(rows: SessionLedgerRow[], sessionId: string, ordinal: number) {
  return foldRowsWithKey(rows, {
    sessionId,
    changeKey: `${sessionId}#${ordinal}`,
    promptOrdinal: ordinal,
  });
}

/**
 * End-stage args that satisfy the #320 artifact requirement: for a thinking stage
 * (planning/specification/review) write a real, non-empty artifact and reference it, so
 * the stage folds to `complete` under the new contract; a mutation stage needs none.
 */
function provenEndArgs(root: string, stage: string): EndStageInput {
  if (!isArtifactBearingStage(stage)) return {};
  const rel = `.paqad/artifacts/${stage}.md`;
  mkdirSync(join(root, '.paqad', 'artifacts'), { recursive: true });
  writeFileSync(join(root, rel), `# ${stage} artifact\n`);
  return { artifactPaths: [rel] };
}

/** A synthetic sha256 artifact digest for hand-built fold rows (#320). */
const FAKE_DIGEST = `sha256-${'a'.repeat(64)}`;

/** Artifact-digest field for a hand-built stage_end row: a thinking stage needs one to
 *  fold `complete` (#320); a mutation stage leaves it null (the edit is its evidence). */
function digestFor(stage: string): { artifact_digest?: string } {
  return isArtifactBearingStage(stage) ? { artifact_digest: FAKE_DIGEST } : {};
}

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

  /** Record a run of stages against a fresh feature and return its dir name (the key). */
  function run(stages: string[], now: () => Date, sessionId = 'ses_test'): string {
    const { dirName } = openStageEvidence(root, { sessionId, adapter: ADAPTER, now });
    for (const stage of stages) {
      startStage(root, stage, { sessionId, dirName, adapter: ADAPTER, now });
      endStage(root, stage, provenEndArgs(root, stage), {
        sessionId,
        dirName,
        adapter: ADAPTER,
        now,
      });
    }
    return dirName;
  }

  const MANDATORY = STAGE_EVIDENCE_STAGES.filter(isMandatoryStage);

  it('opens a per-feature record; a titled re-open mints a distinct feature', () => {
    const a = openStageEvidence(root, { sessionId: 'ses_x', adapter: ADAPTER });
    // Re-opening with no title resolves the SAME active feature (idempotent open).
    const same = openStageEvidence(root, { sessionId: 'ses_x', adapter: ADAPTER });
    expect(same.dirName).toBe(a.dirName);
    expect(a.changeKey).toBe(a.dirName);
    // A titled open is the "new work" signal — a fresh, distinct feature.
    const b = openStageEvidence(root, {
      sessionId: 'ses_x',
      adapter: ADAPTER,
      title: 'Second change',
      issue: null,
    });
    expect(b.dirName).not.toBe(a.dirName);
    expect(currentFeature(root, 'ses_x')).toBe(b.dirName);
  });

  it('stamps a script-clock start and end datetime and derives duration_ms per stage', () => {
    const dir = run(['planning', 'specification'], clock(0, 5000), 'ses_t');
    const fold = foldFeature(root, 'ses_t', dir);
    const planning = fold.stages.find((s) => s.stage === 'planning')!;
    expect(planning.started_at).not.toBeNull();
    expect(planning.ended_at).not.toBeNull();
    // start at t=5000 (after open at 0), end at t=10000 → 5000ms.
    expect(planning.duration_ms).toBe(5000);
    expect(planning.duration_unreliable).toBe(false);
  });

  it('records an out-of-order earlier start instead of rejecting it (issue #310)', () => {
    const now = clock();
    const { dirName } = openStageEvidence(root, { sessionId: 'ses_o', adapter: ADAPTER, now });
    startStage(root, 'development', { sessionId: 'ses_o', dirName, adapter: ADAPTER, now });
    endStage(root, 'development', {}, { sessionId: 'ses_o', dirName, adapter: ADAPTER, now });
    // planning is earlier than development, recorded after it. The recorder used to
    // THROW here — which made the pre-code stages unrecordable once a later stage was
    // recorded (the #310 deadlock). It now records the start; the fold's ordering
    // check is the single, non-destructive judge of order.
    expect(() =>
      startStage(root, 'planning', { sessionId: 'ses_o', dirName, adapter: ADAPTER, now }),
    ).not.toThrow();
    endStage(root, 'planning', {}, { sessionId: 'ses_o', dirName, adapter: ADAPTER, now });
    const fold = foldFeature(root, 'ses_o', dirName);
    expect(fold.stages.find((stage) => stage.stage === 'planning')?.started_at).not.toBeNull();
    expect(fold.completeness.ordering_violations).toContainEqual({
      before: 'planning',
      after: 'development',
    });
  });

  it('rejects an unknown stage', () => {
    expect(() => startStage(root, 'not-a-stage', { sessionId: 'ses_u', adapter: ADAPTER })).toThrow(
      /unknown stage/i,
    );
  });

  it('verify passes (exit 0) when every mandatory stage ran in order', () => {
    const dir = run([...MANDATORY], clock(), 'ses_ok');
    const result = verifyChange(root, { sessionId: 'ses_ok', dirName: dir, adapter: ADAPTER });
    expect(result.verdict).toBe('complete');
    expect(result.ok).toBe(true);
    expect(result.missing_stages).toEqual([]);
  });

  it('verify fails (incomplete) and lists the missing mandatory stage', () => {
    const partial = MANDATORY.filter((s) => s !== 'documentation_sync');
    const dir = run([...partial], clock(), 'ses_miss');
    const result = verifyChange(root, { sessionId: 'ses_miss', dirName: dir, adapter: ADAPTER });
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('incomplete');
    expect(result.missing_stages).toContain('documentation_sync');
  });

  it('escalates to blocked once the redo cap is hit', () => {
    const partial = MANDATORY.filter((s) => s !== 'review');
    const dir = run([...partial], clock(), 'ses_block');
    const ctx = { sessionId: 'ses_block', dirName: dir, adapter: ADAPTER };
    expect(verifyChange(root, ctx).verdict).toBe('incomplete'); // attempt 1
    expect(verifyChange(root, ctx).verdict).toBe('incomplete'); // attempt 2
    const third = verifyChange(root, ctx); // cap hit
    expect(third.verdict).toBe('blocked');
    expect(third.blocked).toBe(true);
  });

  it('#321: the redo cap resets when a new stage mutation is recorded', () => {
    const partial = MANDATORY.filter((s) => s !== 'review');
    const dir = run([...partial], clock(), 'ses_reset');
    const ctx = { sessionId: 'ses_reset', dirName: dir, adapter: ADAPTER };
    expect(verifyChange(root, ctx).verdict).toBe('incomplete'); // failure 1
    expect(verifyChange(root, ctx).verdict).toBe('incomplete'); // failure 2 (cap would hit next)
    // Fresh work: record a new stage row. This is a ledger mutation, so the redo-cap
    // failure count resets — the next verify is incomplete again, NOT blocked.
    startStage(root, 'review', { sessionId: 'ses_reset', dirName: dir, adapter: ADAPTER });
    const afterReset = verifyChange(root, ctx);
    expect(afterReset.verdict).toBe('incomplete');
    expect(afterReset.blocked).toBe(false);
  });

  it('flags an ordering violation when a later stage overlaps an earlier one', () => {
    // Hand-build overlapping events: development starts before specification ends.
    const sessionId = 'ses_overlap';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: ADAPTER });
    const c = (stage: string, kind: 'stage_start' | 'stage_end', t: number) =>
      startStageRaw(root, sessionId, dirName, stage, kind, t);
    c('specification', 'stage_start', 1);
    c('development', 'stage_start', 2); // dev starts...
    c('specification', 'stage_end', 3); // ...before spec ends → violation
    c('development', 'stage_end', 4);
    const fold = foldFeature(root, sessionId, dirName);
    expect(fold.completeness.ordering_violations).toContainEqual({
      before: 'specification',
      after: 'development',
    });
  });

  it('hashes a real artifact over its on-disk bytes', () => {
    const sessionId = 'ses_art';
    writeFileSync(join(root, 'spec.md'), '# spec body');
    const { dirName } = openStageEvidence(root, { sessionId, adapter: ADAPTER });
    startStage(root, 'planning', { sessionId, dirName, adapter: ADAPTER });
    const row = endStage(
      root,
      'planning',
      { artifactPaths: ['spec.md'] },
      { sessionId, dirName, adapter: ADAPTER },
    );
    expect(row.artifact_digest).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(row.artifact_paths).toEqual(['spec.md']);
  });

  it('writes only AJV-valid rows to disk', () => {
    const dir = run(['planning'], clock(), 'ses_valid');
    const rows = readFeatureStageUnit(root, dir);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(validateStageEvidenceRow(row)).toEqual([]);
    }
  });

  it('persists the ledger as JSONL inside the feature bundle', () => {
    const dir = run(['planning'], clock(), 'ses_path');
    const file = join(root, featureStagePath(dir));
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3); // open + start + end
    expect(JSON.parse(lines[0]).kind).toBe('open');
    expect(featureStagePath(dir)).toContain('.paqad/ledger/feature-evidence/');
  });

  it('rejects an unknown stage on end as well as start', () => {
    expect(() => endStage(root, 'bogus', {}, { sessionId: 'ses_e', adapter: ADAPTER })).toThrow(
      /unknown stage/i,
    );
  });

  it('yields a null artifact_digest for a named-but-missing or empty artifact (#320)', () => {
    // #320 inverts the old behaviour: a missing/empty artifact must NOT produce a
    // digest — otherwise a thinking stage could name a nonexistent file and still look
    // proven. A null digest folds the stage `inconclusive`, never `complete`.
    const sessionId = 'ses_absent';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: ADAPTER });
    startStage(root, 'planning', { sessionId, dirName, adapter: ADAPTER });
    const missing = endStage(
      root,
      'planning',
      { artifactPaths: ['nope.md'] },
      { sessionId, dirName, adapter: ADAPTER },
    );
    expect(missing.artifact_digest).toBeNull();

    // An empty (0-byte) file is likewise not substantive → null.
    writeFileSync(join(root, 'empty.md'), '');
    startStage(root, 'specification', { sessionId, dirName, adapter: ADAPTER });
    const empty = endStage(
      root,
      'specification',
      { artifactPaths: ['empty.md'] },
      { sessionId, dirName, adapter: ADAPTER },
    );
    expect(empty.artifact_digest).toBeNull();
  });

  it('verify resolves the active feature when no dirName is passed, and throws when none is open', () => {
    expect(() => verifyChange(root, { sessionId: 'ses_v0', adapter: ADAPTER })).toThrow(
      /no open stage-evidence change/i,
    );
    run(['planning'], clock(), 'ses_v1');
    // No dirName passed → resolves via the active feature in the `_session` control.
    const result = verifyChange(root, { sessionId: 'ses_v1', adapter: ADAPTER });
    expect(result.verdict).toBe('incomplete'); // only planning ran
  });

  it('auto-opens a change when a stage is started without an explicit open', () => {
    // No openStageEvidence call and no dirName — the recorder opens a feature itself.
    const row = startStage(root, 'planning', { sessionId: 'ses_auto', adapter: ADAPTER });
    expect(row.conversation_ordinal).toBe(1);
    const dir = currentFeature(root, 'ses_auto')!;
    const rows = readFeatureStageUnit(root, dir);
    expect(rows[0].kind).toBe('open');
    expect(rows.some((r) => r.kind === 'stage_start')).toBe(true);
  });
});

describe('foldRows edge cases (#247)', () => {
  const row = (partial: Partial<SessionLedgerRow>): SessionLedgerRow =>
    ({
      schema_version: 1,
      doc_type: STAGE_EVIDENCE_DOC_TYPE,
      session_id: 'ses',
      conversation_ordinal: 1,
      ts: new Date(0).toISOString(),
      content_hash: 'x',
      ...partial,
    }) as SessionLedgerRow;

  it('returns cannot-verify for an empty change', () => {
    const fold = foldRows([], 'ses', 1);
    expect(fold.completeness.verdict).toBe('cannot-verify');
  });

  it('returns incomplete when every mandatory stage ran but ordering is violated', () => {
    const mandatory = STAGE_EVIDENCE_STAGES.filter(isMandatoryStage);
    const rows: SessionLedgerRow[] = [];
    let t = 1000;
    for (const stage of mandatory) {
      rows.push(row({ kind: 'stage_start', stage, event_status: 'started', ts: iso(t) }));
      rows.push(
        row({
          kind: 'stage_end',
          stage,
          event_status: 'completed',
          ts: iso(t + 100),
          ...digestFor(stage),
        }),
      );
      t += 200;
    }
    // Inject an overlap: re-end `planning` long AFTER `specification` started. The
    // re-end is the last planning end, so it must carry a digest too (planning is
    // artifact-bearing) or the stage would fold inconclusive and hide the ordering test.
    rows.push(
      row({ kind: 'stage_start', stage: 'planning', event_status: 'started', ts: iso(900) }),
    );
    rows.push(
      row({
        kind: 'stage_end',
        stage: 'planning',
        event_status: 'completed',
        ts: iso(5000),
        ...digestFor('planning'),
      }),
    );

    const fold = foldRows(rows, 'ses', 1);
    expect(fold.completeness.missing_stages).toEqual([]);
    expect(fold.completeness.ordering_violations.length).toBeGreaterThan(0);
    expect(fold.completeness.verdict).toBe('incomplete');
  });

  it('clamps a negative duration and flags it unreliable', () => {
    const rows = [
      row({ kind: 'stage_start', stage: 'planning', event_status: 'started', ts: iso(5000) }),
      row({ kind: 'stage_end', stage: 'planning', event_status: 'completed', ts: iso(1000) }),
    ];
    const planning = foldRows(rows, 'ses', 1).stages.find((s) => s.stage === 'planning')!;
    expect(planning.duration_ms).toBe(0);
    expect(planning.duration_unreliable).toBe(true);
  });

  it('marks a skipped stage skipped', () => {
    const rows = [row({ kind: 'stage_end', stage: 'review', event_status: 'skipped', ts: iso(1) })];
    const review = foldRows(rows, 'ses', 1).stages.find((s) => s.stage === 'review')!;
    expect(review.state).toBe('skipped');
  });

  it('derives failed, running, and redone stage states', () => {
    const failed = foldRows(
      [row({ kind: 'stage_end', stage: 'checks', event_status: 'failed', ts: iso(1) })],
      'ses',
      1,
    ).stages.find((s) => s.stage === 'checks')!;
    expect(failed.state).toBe('failed');

    const running = foldRows(
      [row({ kind: 'stage_start', stage: 'development', event_status: 'started', ts: iso(1) })],
      'ses',
      1,
    ).stages.find((s) => s.stage === 'development')!;
    expect(running.state).toBe('running');

    const redone = foldRows(
      [
        row({ kind: 'stage_start', stage: 'review', event_status: 'redone', ts: iso(1) }),
        row({ kind: 'stage_end', stage: 'review', event_status: 'completed', ts: iso(2) }),
      ],
      'ses',
      1,
    ).stages.find((s) => s.stage === 'review')!;
    expect(redone.state).toBe('redone');
  });

  it('returns recovered when all mandatory stages completed after a redo', () => {
    const mandatory = STAGE_EVIDENCE_STAGES.filter(isMandatoryStage);
    const rows: SessionLedgerRow[] = [];
    let t = 1000;
    for (const stage of mandatory) {
      const status = stage === 'review' ? 'redone' : 'started';
      rows.push(row({ kind: 'stage_start', stage, event_status: status, ts: iso(t) }));
      rows.push(
        row({
          kind: 'stage_end',
          stage,
          event_status: 'completed',
          ts: iso(t + 100),
          ...digestFor(stage),
        }),
      );
      t += 200;
    }
    expect(foldRows(rows, 'ses', 1).completeness.verdict).toBe('recovered');
  });
});

describe('completion-anchored review (#270)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-stage-ev-270-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const BUILD_ORDER = [
    'planning',
    'specification',
    'development',
    'checks',
    'documentation_sync',
  ] as const;

  /** Record planning→docs in build order, so `checks`/`documentation_sync` are on the
   *  ledger before the explicit review — the exact shape issue #270 describes. */
  function recordBuild(sessionId: string, now: () => Date): string {
    const { dirName } = openStageEvidence(root, { sessionId, adapter: ADAPTER, now });
    const ctx = { sessionId, dirName, adapter: ADAPTER, now };
    for (const stage of BUILD_ORDER) {
      startStage(root, stage, ctx);
      endStage(root, stage, provenEndArgs(root, stage), ctx);
    }
    return dirName;
  }

  it('marks only review as completion-anchored; every other stage stays ordered', () => {
    expect(COMPLETION_ANCHORED_STAGES).toEqual(['review']);
    expect(isCompletionAnchoredStage('review')).toBe(true);
    for (const stage of BUILD_ORDER) {
      expect(isCompletionAnchoredStage(stage)).toBe(false);
    }
  });

  it('records a review start AFTER checks/docs already started, without an out-of-order throw', () => {
    const now = clock();
    const dir = recordBuild('ses_late_start', now);
    const ctx = { sessionId: 'ses_late_start', dirName: dir, adapter: ADAPTER, now };
    // review is canonically before checks/docs; the strict recorder would throw here.
    expect(() => startStage(root, 'review', ctx)).not.toThrow();
    endStage(root, 'review', provenEndArgs(root, 'review'), ctx);
    const rows = readFeatureStageUnit(root, dir);
    expect(rows.some((r) => r.kind === 'stage_start' && r.stage === 'review')).toBe(true);
    expect(rows.some((r) => r.kind === 'stage_end' && r.stage === 'review')).toBe(true);
  });

  it('AC-1/AC-4: a review recorded after checks + docs passes with no ordering violation', () => {
    const now = clock();
    const dir = recordBuild('ses_late', now);
    const ctx = { sessionId: 'ses_late', dirName: dir, adapter: ADAPTER, now };
    startStage(root, 'review', ctx);
    endStage(root, 'review', provenEndArgs(root, 'review'), ctx);

    const fold = foldFeature(root, 'ses_late', dir);
    expect(fold.completeness.ordering_violations).toEqual([]);

    const result = verifyChange(root, { sessionId: 'ses_late', dirName: dir, adapter: ADAPTER });
    expect(result.verdict).toBe('complete');
    expect(result.ok).toBe(true);
    expect(result.missing_stages).toEqual([]);
  });

  it('AC-2/AC-3: a review that is never marked stays missing → incomplete (honesty floor)', () => {
    const now = clock();
    const dir = recordBuild('ses_noreview', now);
    const result = verifyChange(root, {
      sessionId: 'ses_noreview',
      dirName: dir,
      adapter: ADAPTER,
    });
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('incomplete');
    expect(result.missing_stages).toEqual(['review']);
  });

  it('still flags a genuine out-of-order overlap between two NON-anchored stages', () => {
    // Regression guard: the exemption is scoped to review only. A checks/docs overlap
    // (documentation_sync starts before checks ends) must still be a violation.
    const sessionId = 'ses_realviolation';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: ADAPTER });
    startStageRaw(root, sessionId, dirName, 'checks', 'stage_start', 1);
    startStageRaw(root, sessionId, dirName, 'documentation_sync', 'stage_start', 2); // docs starts…
    startStageRaw(root, sessionId, dirName, 'checks', 'stage_end', 3); // …before checks ends → violation
    startStageRaw(root, sessionId, dirName, 'documentation_sync', 'stage_end', 4);
    const fold = foldFeature(root, sessionId, dirName);
    expect(fold.completeness.ordering_violations).toContainEqual({
      before: 'checks',
      after: 'documentation_sync',
    });
  });

  it('#310: a live-mark end with no matching start is inconclusive, not complete', () => {
    // The orphan-end signature of the old deadlock: the recorder rejected the
    // out-of-order start but accepted the end, leaving a stage with an end alone.
    // It must NOT read as `complete`, so the completion fold and the pre-mutation gate
    // (which needs a start+end pair) agree the stage is not done.
    const rows = [
      foldRow({ kind: 'stage_end', stage: 'planning', evidence_source: 'live-mark', ts: iso(1) }),
    ];
    const planning = foldRows(rows, 'ses', 1).stages.find((s) => s.stage === 'planning')!;
    expect(planning.state).toBe('inconclusive');
    expect(foldRows(rows, 'ses', 1).completeness.missing_stages).toContain('planning');
  });

  it('#320: an artifact-bearing stage with a start+end but no digest is inconclusive', () => {
    const rows = [
      foldRow({ kind: 'stage_start', stage: 'planning', ts: iso(1) }),
      foldRow({ kind: 'stage_end', stage: 'planning', ts: iso(2) }), // no artifact_digest
    ];
    const planning = foldRows(rows, 'ses', 1).stages.find((s) => s.stage === 'planning')!;
    expect(planning.state).toBe('inconclusive');
    expect(foldRows(rows, 'ses', 1).completeness.missing_stages).toContain('planning');
  });

  it('#320: an artifact-bearing stage WITH a digest folds complete', () => {
    const rows = [
      foldRow({ kind: 'stage_start', stage: 'planning', ts: iso(1) }),
      foldRow({
        kind: 'stage_end',
        stage: 'planning',
        ts: iso(2),
        artifact_digest: `sha256-${'b'.repeat(64)}`,
      }),
    ];
    const planning = foldRows(rows, 'ses', 1).stages.find((s) => s.stage === 'planning')!;
    expect(planning.state).toBe('complete');
  });

  it('#320: a mutation stage (development) with a start+end but no digest stays complete', () => {
    const rows = [
      foldRow({ kind: 'stage_start', stage: 'development', ts: iso(1) }),
      foldRow({ kind: 'stage_end', stage: 'development', ts: iso(2) }), // no digest, but exempt
    ];
    const dev = foldRows(rows, 'ses', 1).stages.find((s) => s.stage === 'development')!;
    expect(dev.state).toBe('complete');
  });

  it('#310: an inferred-git backstop end (no start) still counts as complete (exempt)', () => {
    const rows = [
      foldRow({
        kind: 'stage_end',
        stage: 'development',
        event_status: 'inferred',
        evidence_source: 'inferred-git',
        ts: iso(1),
      }),
    ];
    const dev = foldRows(rows, 'ses', 1).stages.find((s) => s.stage === 'development')!;
    expect(dev.state).toBe('complete');
  });
});

/** Build a minimal folded-input row (module-level so the #310 fold tests above are
 *  self-contained, mirroring the local `row` helper in the fold describe block). */
function foldRow(partial: Partial<SessionLedgerRow>): SessionLedgerRow {
  return {
    schema_version: 1,
    doc_type: STAGE_EVIDENCE_DOC_TYPE,
    session_id: 'ses',
    conversation_ordinal: 1,
    ts: new Date(0).toISOString(),
    content_hash: 'x',
    ...partial,
  } as SessionLedgerRow;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Append a raw stage_start/stage_end with a fixed clock instant (for overlap tests). */
function startStageRaw(
  root: string,
  sessionId: string,
  dirName: string,
  stage: string,
  kind: 'stage_start' | 'stage_end',
  t: number,
): void {
  if (kind === 'stage_start') {
    startStage(root, stage, {
      sessionId,
      dirName,
      adapter: 'claude-code',
      now: () => new Date(t),
    });
  } else {
    endStage(
      root,
      stage,
      {},
      { sessionId, dirName, adapter: 'claude-code', now: () => new Date(t) },
    );
  }
}
