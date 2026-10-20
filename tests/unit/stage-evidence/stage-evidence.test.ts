import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  augmentWithBundleArtifacts,
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
import { featureFilePath } from '@/feature-evidence/paths.js';
import {
  currentFeature,
  featureStagePath,
  foldFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { type SessionLedgerRow } from '@/session-ledger/ledger.js';

function foldRows(rows: SessionLedgerRow[], sessionId: string, ordinal: number) {
  return foldRowsWithKey(rows, {
    sessionId,
    changeKey: `${sessionId}#${ordinal}`,
    promptOrdinal: ordinal,
  });
}

function provenEndArgs(root: string, dirName: string, stage: string): EndStageInput {
  if (!isArtifactBearingStage(stage)) return {};
  const file = stage === 'planning' ? 'plan' : stage === 'specification' ? 'specification' : null;
  const rel = file ? featureFilePath(dirName, file) : `.paqad/artifacts/${stage}.md`;
  mkdirSync(join(root, dirname(rel)), { recursive: true });
  writeFileSync(join(root, rel), file ? '{"real":true}\n' : `# ${stage} artifact\n`);
  return { artifactPaths: [rel] };
}

const FAKE_DIGEST = `sha256-${'a'.repeat(64)}`;

function digestFor(stage: string): { artifact_digest?: string } {
  return isArtifactBearingStage(stage) ? { artifact_digest: FAKE_DIGEST } : {};
}

function clock(startMs = 1_000_000, stepMs = 1000): () => Date {
  let t = startMs - stepMs;
  return () => {
    t += stepMs;
    return new Date(t);
  };
}

const ADAPTER = 'claude-code';

describe('stage-evidence ledger', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-stage-ev-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function run(stages: string[], now: () => Date, sessionId = 'ses_test'): string {
    const { dirName } = openStageEvidence(root, { sessionId, adapter: ADAPTER, now });
    for (const stage of stages) {
      startStage(root, stage, { sessionId, dirName, adapter: ADAPTER, now });
      endStage(root, stage, provenEndArgs(root, dirName, stage), {
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
    const same = openStageEvidence(root, { sessionId: 'ses_x', adapter: ADAPTER });
    expect(same.dirName).toBe(a.dirName);
    expect(a.changeKey).toBe(a.dirName);
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
    expect(planning.duration_ms).toBe(5000);
    expect(planning.duration_unreliable).toBe(false);
  });

  it('records an out-of-order earlier start instead of rejecting it', () => {
    const now = clock();
    const { dirName } = openStageEvidence(root, { sessionId: 'ses_o', adapter: ADAPTER, now });
    startStage(root, 'development', { sessionId: 'ses_o', dirName, adapter: ADAPTER, now });
    endStage(root, 'development', {}, { sessionId: 'ses_o', dirName, adapter: ADAPTER, now });
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

  describe('bundle-artifact assertion in the verdict', () => {
    it('folds incomplete when plan.json is missing even though every stage row is complete', () => {
      const dir = run([...MANDATORY], clock(), 'ses_noplan');
      rmSync(join(root, featureFilePath(dir, 'plan')), { force: true });
      const result = verifyChange(root, {
        sessionId: 'ses_noplan',
        dirName: dir,
        adapter: ADAPTER,
      });
      expect(result.verdict).toBe('incomplete');
      expect(result.ok).toBe(false);
      expect(result.missing_stages).toContain('planning');
    });

    it('folds incomplete when specification.json is missing', () => {
      const dir = run([...MANDATORY], clock(), 'ses_nospec');
      rmSync(join(root, featureFilePath(dir, 'specification')), { force: true });
      const result = verifyChange(root, {
        sessionId: 'ses_nospec',
        dirName: dir,
        adapter: ADAPTER,
      });
      expect(result.verdict).toBe('incomplete');
      expect(result.missing_stages).toContain('specification');
    });

    it('folds incomplete when an empty plan.json is present (not substantive evidence)', () => {
      const dir = run([...MANDATORY], clock(), 'ses_emptyplan');
      writeFileSync(join(root, featureFilePath(dir, 'plan')), '');
      const result = verifyChange(root, {
        sessionId: 'ses_emptyplan',
        dirName: dir,
        adapter: ADAPTER,
      });
      expect(result.verdict).toBe('incomplete');
      expect(result.missing_stages).toContain('planning');
    });

    describe('augmentWithBundleArtifacts (pure)', () => {
      const base = foldRows([], 'ses', 1);

      it('leaves a fold untouched when both artifacts are present', () => {
        const out = augmentWithBundleArtifacts(base, { plan: true, specification: true });
        expect(out).toBe(base);
      });

      it('downgrades complete→incomplete and lists planning when plan.json is absent', () => {
        const complete = {
          ...base,
          completeness: { ...base.completeness, verdict: 'complete' as const, missing_stages: [] },
        };
        const out = augmentWithBundleArtifacts(complete, { plan: false, specification: true });
        expect(out.completeness.verdict).toBe('incomplete');
        expect(out.completeness.missing_stages).toContain('planning');
        expect(out.completeness.missing_stages).not.toContain('specification');
      });

      it('downgrades a recovered verdict too when specification.json is absent', () => {
        const recovered = {
          ...base,
          completeness: {
            ...base.completeness,
            verdict: 'recovered' as const,
            missing_stages: [],
          },
        };
        const out = augmentWithBundleArtifacts(recovered, { plan: true, specification: false });
        expect(out.completeness.verdict).toBe('incomplete');
        expect(out.completeness.missing_stages).toContain('specification');
      });

      it('preserves an already-incomplete verdict but surfaces the missing artifact', () => {
        const incomplete = {
          ...base,
          completeness: {
            ...base.completeness,
            verdict: 'incomplete' as const,
            missing_stages: ['review'],
          },
        };
        const out = augmentWithBundleArtifacts(incomplete, { plan: false, specification: false });
        expect(out.completeness.verdict).toBe('incomplete');
        expect(out.completeness.missing_stages).toEqual(
          expect.arrayContaining(['review', 'planning', 'specification']),
        );
      });

      it('does not duplicate a stage already listed missing', () => {
        const already = {
          ...base,
          completeness: {
            ...base.completeness,
            verdict: 'incomplete' as const,
            missing_stages: ['planning'],
          },
        };
        const out = augmentWithBundleArtifacts(already, { plan: false, specification: true });
        expect(out.completeness.missing_stages.filter((s) => s === 'planning')).toHaveLength(1);
      });
    });
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
    expect(verifyChange(root, ctx).verdict).toBe('incomplete');
    expect(verifyChange(root, ctx).verdict).toBe('incomplete');
    const third = verifyChange(root, ctx);
    expect(third.verdict).toBe('blocked');
    expect(third.blocked).toBe(true);
  });

  it('the redo cap resets when a new stage mutation is recorded', () => {
    const partial = MANDATORY.filter((s) => s !== 'review');
    const dir = run([...partial], clock(), 'ses_reset');
    const ctx = { sessionId: 'ses_reset', dirName: dir, adapter: ADAPTER };
    expect(verifyChange(root, ctx).verdict).toBe('incomplete');
    expect(verifyChange(root, ctx).verdict).toBe('incomplete');
    startStage(root, 'review', { sessionId: 'ses_reset', dirName: dir, adapter: ADAPTER });
    const afterReset = verifyChange(root, ctx);
    expect(afterReset.verdict).toBe('incomplete');
    expect(afterReset.blocked).toBe(false);
  });

  it('flags an ordering violation when a later stage overlaps an earlier one', () => {
    const sessionId = 'ses_overlap';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: ADAPTER });
    const c = (stage: string, kind: 'stage_start' | 'stage_end', t: number) =>
      startStageRaw(root, sessionId, dirName, stage, kind, t);
    c('specification', 'stage_start', 1);
    c('development', 'stage_start', 2);
    c('specification', 'stage_end', 3);
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
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(lines[0]).kind).toBe('open');
    expect(featureStagePath(dir)).toContain('.paqad/ledger/feature-evidence/');
  });

  it('rejects an unknown stage on end as well as start', () => {
    expect(() => endStage(root, 'bogus', {}, { sessionId: 'ses_e', adapter: ADAPTER })).toThrow(
      /unknown stage/i,
    );
  });

  it('yields a null artifact_digest for a named-but-missing or empty artifact', () => {
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
    const result = verifyChange(root, { sessionId: 'ses_v1', adapter: ADAPTER });
    expect(result.verdict).toBe('incomplete');
  });

  it('auto-opens a change when a stage is started without an explicit open', () => {
    const row = startStage(root, 'planning', { sessionId: 'ses_auto', adapter: ADAPTER });
    const dir = currentFeature(root, 'ses_auto')!;
    expect(row).toMatchObject({ change: dir.slice(-26), recorded_at: expect.any(String) });
    const rows = readFeatureStageUnit(root, dir);
    expect(rows[0].kind).toBe('open');
    expect(rows.some((r) => r.kind === 'stage_start')).toBe(true);
  });
});

describe('foldRows edge cases', () => {
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

describe('completion-anchored review', () => {
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

  function recordBuild(sessionId: string, now: () => Date): string {
    const { dirName } = openStageEvidence(root, { sessionId, adapter: ADAPTER, now });
    const ctx = { sessionId, dirName, adapter: ADAPTER, now };
    for (const stage of BUILD_ORDER) {
      startStage(root, stage, ctx);
      endStage(root, stage, provenEndArgs(root, dirName, stage), ctx);
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
    expect(() => startStage(root, 'review', ctx)).not.toThrow();
    endStage(root, 'review', provenEndArgs(root, dir, 'review'), ctx);
    const rows = readFeatureStageUnit(root, dir);
    expect(rows.some((r) => r.kind === 'stage_start' && r.stage === 'review')).toBe(true);
    expect(rows.some((r) => r.kind === 'stage_end' && r.stage === 'review')).toBe(true);
  });

  it('AC-1/AC-4: a review recorded after checks + docs passes with no ordering violation', () => {
    const now = clock();
    const dir = recordBuild('ses_late', now);
    const ctx = { sessionId: 'ses_late', dirName: dir, adapter: ADAPTER, now };
    startStage(root, 'review', ctx);
    endStage(root, 'review', provenEndArgs(root, dir, 'review'), ctx);

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
    const sessionId = 'ses_realviolation';
    const { dirName } = openStageEvidence(root, { sessionId, adapter: ADAPTER });
    startStageRaw(root, sessionId, dirName, 'checks', 'stage_start', 1);
    startStageRaw(root, sessionId, dirName, 'documentation_sync', 'stage_start', 2);
    startStageRaw(root, sessionId, dirName, 'checks', 'stage_end', 3);
    startStageRaw(root, sessionId, dirName, 'documentation_sync', 'stage_end', 4);
    const fold = foldFeature(root, sessionId, dirName);
    expect(fold.completeness.ordering_violations).toContainEqual({
      before: 'checks',
      after: 'documentation_sync',
    });
  });

  it('a live-mark end with no matching start is inconclusive, not complete', () => {
    const rows = [
      foldRow({ kind: 'stage_end', stage: 'planning', evidence_source: 'live-mark', ts: iso(1) }),
    ];
    const planning = foldRows(rows, 'ses', 1).stages.find((s) => s.stage === 'planning')!;
    expect(planning.state).toBe('inconclusive');
    expect(foldRows(rows, 'ses', 1).completeness.missing_stages).toContain('planning');
  });

  it('an artifact-bearing stage with a start+end but no digest is inconclusive', () => {
    const rows = [
      foldRow({ kind: 'stage_start', stage: 'planning', ts: iso(1) }),
      foldRow({ kind: 'stage_end', stage: 'planning', ts: iso(2) }),
    ];
    const planning = foldRows(rows, 'ses', 1).stages.find((s) => s.stage === 'planning')!;
    expect(planning.state).toBe('inconclusive');
    expect(foldRows(rows, 'ses', 1).completeness.missing_stages).toContain('planning');
  });

  it('an artifact-bearing stage WITH a digest folds complete', () => {
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

  it('a mutation stage (development) with a start+end but no digest stays complete', () => {
    const rows = [
      foldRow({ kind: 'stage_start', stage: 'development', ts: iso(1) }),
      foldRow({ kind: 'stage_end', stage: 'development', ts: iso(2) }),
    ];
    const dev = foldRows(rows, 'ses', 1).stages.find((s) => s.stage === 'development')!;
    expect(dev.state).toBe('complete');
  });

  it('an inferred-git backstop end (no start) still counts as complete (exempt)', () => {
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
