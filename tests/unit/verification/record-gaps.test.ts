import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { GATE_CATALOG } from '@/core/types/verification.js';
import type { EvidenceGateStatus } from '@/core/types/verification-evidence.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { hudVerdictPath } from '@/hud/files.js';
import { writeHudReceipt } from '@/hud/receipt-file.js';
import { buildHudSnapshot } from '@/hud/snapshot.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import { finalizeStageEvidence } from '@/stage-evidence/finalize.js';
import { startStage } from '@/stage-evidence/recorder.js';
import {
  formatVerdictSummary,
  type RepositoryVerificationGateVerdict,
} from '@/verification/repository/verdict.js';
import { unrecordedStagesGap, verdictKindFor, verdictParts } from '@/verification/verdict-kind.js';

import { verdictHasHardFailure } from '../../../runtime/scripts/verify-backstop.mjs';

const FIX_IT = 'Fix it and run the checks again';
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function gate(
  name: string,
  status: EvidenceGateStatus,
  detail = `${name} detail`,
): RepositoryVerificationGateVerdict {
  return {
    gate: name as RepositoryVerificationGateVerdict['gate'],
    status,
    detail,
    remediation: null,
  };
}

const WORK_GREEN = [gate('code-tests-lint', 'pass'), gate('ac-test-mapping', 'pass')];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'paqad-record-gaps-'));
  roots.push(dir);
  mkdirSync(join(dir, '.paqad'), { recursive: true });
  writeFileSync(join(dir, PATHS.FRAMEWORK_PATH), '~/.paqad-ai/current\n');
  return dir;
}

function strayChange(projectRoot: string, session: string): string {
  const dir = openFeatureChange(projectRoot, session, { adapter: 'claude-code' });
  persistLedgerSessionId(projectRoot, session);
  writeWorkflowState(projectRoot, session, {
    active: { workflow: 'feature-development', lane: 'full', reason: 'a full change' },
    paused: [],
  });
  startStage(projectRoot, 'planning', { sessionId: session, adapter: 'claude-code' });
  return dir;
}

describe('the catalog names who owns each gate', () => {
  it('classifies paqad bookkeeping as paqad-record and everything else as the work', () => {
    for (const code of [
      'stage-evidence',
      'bundle-completeness',
      'unrecorded-mandatory-stages',
      'rules-loaded',
      'evidence-existence',
      'fix-proof',
    ] as const) {
      expect(GATE_CATALOG[code].owner).toBe('paqad-record');
    }
    expect(GATE_CATALOG['code-tests-lint'].owner).toBe('work');
    expect(GATE_CATALOG['spec-review'].owner).toBe('work');
  });
});

describe('AC-5: only paqad-record gates fail', () => {
  const gates = [...WORK_GREEN, gate('stage-evidence', 'fail', 'missing stage(s): [review].')];

  it('AC-5: the work verdict is pass, the overall kind and the Stop block match main', () => {
    const parts = verdictParts(gates);
    expect(parts.work_kind).toBe('pass');
    expect(parts.work_reasons).toEqual([]);
    expect(parts.record_gaps.map((gap) => gap.text)).toEqual([
      'paqad could not record every stage of this change',
    ]);
    expect(verdictKindFor(gates)).toBe('fail');
    expect(verdictHasHardFailure({ gates })).toBe(true);
  });

  it('AC-5: the receipt says paqad could not record X with no instruction to fix it', () => {
    const summary = formatVerdictSummary({ ok: false, gates, escalations: [] });
    expect(summary).toContain('paqad could not record every stage of this change');
    expect(summary).toContain('missing stage(s): [review].');
    expect(summary).not.toContain(FIX_IT);
    expect(summary).not.toMatch(/🔴 stage-evidence/);
  });

  it('AC-5: the HUD verdict record carries both parts beside the unchanged kind', () => {
    const projectRoot = root();
    const written = writeHudReceipt(projectRoot, 'ses-ac5', {
      summary: 's',
      receipt: 'r',
      gates,
      kind: 'fail',
      change: 'dir-x',
      ...verdictParts(gates),
    });
    expect(written?.verdict).toMatchObject({
      kind: 'fail',
      change: 'dir-x',
      work_kind: 'pass',
      work_reasons: [],
      record_gaps: ['paqad could not record every stage of this change'],
    });
  });
});

describe('AC-29: only paqad bookkeeping is missing', () => {
  it('AC-29: stage records, bundle files and the rules marker leave the work verdict alone', () => {
    const gates = [
      ...WORK_GREEN,
      gate('stage-evidence', 'fail'),
      gate('bundle-completeness', 'fail'),
      gate('rules-loaded', 'fail'),
    ];
    const parts = verdictParts(gates, ['review']);
    expect(parts.work_kind).toBe('pass');
    expect(parts.record_gaps.map((gap) => gap.code)).toEqual([
      'stage-evidence',
      'bundle-completeness',
      'rules-loaded',
      'unrecorded-mandatory-stages',
    ]);
    const summary = formatVerdictSummary({
      ok: true,
      gates: WORK_GREEN,
      escalations: [],
      unrecordedMandatoryStages: ['review'],
    });
    expect(summary).toContain('No record yet for: Review');
    expect(summary).not.toContain('Mark them');
    expect(summary).not.toContain(FIX_IT);
  });

  it('AC-29: a missing checks report stays the work, not bookkeeping', () => {
    const parts = verdictParts([
      gate('code-tests-lint', 'inconclusive', 'No checks report on record.'),
    ]);
    expect(parts.work_kind).toBe('inconclusive');
    expect(parts.record_gaps).toEqual([]);
    expect(parts.work_reasons).toEqual(['code-tests-lint: No checks report on record.']);
  });
});

describe('AC-30 and AC-26: legacy records on disk', () => {
  it('AC-30: a change-null verdict in the old shape reads as could not prove, never pass', () => {
    const projectRoot = root();
    const S = 'ses-legacy';
    strayChange(projectRoot, S);
    const verdictPath = hudVerdictPath(projectRoot, S);
    mkdirSync(dirname(verdictPath), { recursive: true });
    const legacy = `${JSON.stringify(
      {
        schema: 'paqad.hud-verdict/1',
        session_id: S,
        change: null,
        word: 'Safe to merge',
        passed: true,
        reasons: [],
        written_at: new Date(Date.now() + 60_000).toISOString(),
      },
      null,
      2,
    )}\n`;
    writeFileSync(verdictPath, legacy);

    const snapshot = buildHudSnapshot(projectRoot, S);

    expect(snapshot.verdict?.kind).toBe('inconclusive');
    expect(snapshot.verdict?.passed).toBe(false);
    expect(snapshot.verdict?.record_gaps).toContain(
      'paqad could not record which change this verdict judged',
    );
    expect(readFileSync(verdictPath, 'utf8')).toBe(legacy);
  });

  it('AC-26: a stray untitled lane-null change is labelled paqad gap and left byte-identical', () => {
    const projectRoot = root();
    const S = 'ses-stray';
    const dir = strayChange(projectRoot, S);
    const recordPath = join(projectRoot, featureFilePath(dir, 'feature'));
    const before = readFileSync(recordPath, 'utf8');

    const snapshot = buildHudSnapshot(projectRoot, S);

    expect(snapshot.record_gaps).toContain('paqad could not record the lane for this change');
    expect(snapshot.verdict?.kind ?? null).not.toBe('pass');
    expect(snapshot.headline.gap ?? '').not.toContain('paqad could not record');
    expect(readFileSync(recordPath, 'utf8')).toBe(before);
  });
});

describe('AC-33: a repaired paqad gap writes an audit row', () => {
  it('AC-33: a turn-end stage end names what was repaired and when', () => {
    const projectRoot = root();
    const S = 'ses-repair';
    const dir = strayChange(projectRoot, S);
    startStage(projectRoot, 'development', { sessionId: S, adapter: 'claude-code' });

    finalizeStageEvidence(projectRoot, {
      adapter: 'backstop',
      sessionId: S,
      changedFilesCount: 1,
      deferClose: true,
    });

    const repairs = readFeatureStageUnit(projectRoot, dir).filter(
      (row) => row.kind === 'record-repair',
    );
    expect(repairs.map((row) => row.reason)).toEqual(
      expect.arrayContaining([expect.stringContaining('development')]),
    );
    expect(typeof repairs[0]?.recorded_at).toBe('string');

    const snapshot = buildHudSnapshot(projectRoot, S);
    expect(snapshot.repairs?.map((repair) => repair.what)).toEqual(
      expect.arrayContaining([expect.stringContaining('development')]),
    );
  });
});

describe('AC-17: the stages gap names the stages and blames nobody', () => {
  it('reads "No record yet for" with the stage words, never "paqad could not record"', () => {
    const gap = unrecordedStagesGap(['specification', 'development', 'documentation_sync']);
    expect(gap.text).toBe('No record yet for: Spec, Build, Docs');
    expect(gap.text).not.toContain('paqad could not record');
  });
});
