import { describe, expect, it } from 'vitest';

import { PAQAD_STATUS_GLYPH, PAQAD_VERDICT, paqadFrameLead } from '@/core/constants/paqad-voice.js';
import {
  composeChangeReceipt,
  formatStageEvidenceReceipt,
  unrecordedMandatoryStages,
} from '@/verification/repository/receipt.js';
import { formatVerdictSummary } from '@/verification/repository/verdict.js';
import type { FoldedChange, FoldedStage, StageState } from '@/stage-evidence/types.js';

function stage(name: string, state: StageState, extra: Partial<FoldedStage> = {}): FoldedStage {
  return {
    stage: name,
    state,
    started_at: state === 'missing' ? null : '2026-07-09T00:00:00.000Z',
    ended_at: null,
    duration_ms: null,
    duration_unreliable: false,
    evidence_source: 'live-mark',
    artifact_digest: null,
    ...extra,
  };
}

function fold(stages: FoldedStage[]): FoldedChange {
  return {
    session_id: 's',
    change_key: 's#1',
    prompt_ordinal: 1,
    stages,
    lane: 'full',
    completeness: {
      verdict: 'complete',
      missing_stages: [],
      required_passed: 0,
      required_total: 0,
      ordering_violations: [],
    },
  };
}

describe('formatStageEvidenceReceipt', () => {
  it('renders a complete stage as 🟢 done', () => {
    const out = formatStageEvidenceReceipt(fold([stage('planning', 'complete')]));
    expect(out).toContain(`${PAQAD_STATUS_GLYPH.good} planning — done`);
  });

  it('renders an inconclusive stage as 🟡 "marked (no recorded work)", never done', () => {
    const out = formatStageEvidenceReceipt(fold([stage('specification', 'inconclusive')]));
    expect(out).toContain(
      `${PAQAD_STATUS_GLYPH.needsLook} specification — marked (no recorded work)`,
    );
    expect(out).not.toContain('done');
  });

  it('renders a complete-but-near-zero-duration stage as 🟡, never 🟢 done', () => {
    const out = formatStageEvidenceReceipt(
      fold([stage('planning', 'complete', { duration_unreliable: true })]),
    );
    expect(out).toContain(PAQAD_STATUS_GLYPH.needsLook);
    expect(out).toContain('near-zero duration');
    expect(out).not.toContain(`${PAQAD_STATUS_GLYPH.good} planning — done`);
  });

  it('flags provenance for inferred and redone evidence', () => {
    const inferred = formatStageEvidenceReceipt(
      fold([stage('development', 'complete', { evidence_source: 'inferred-git' })]),
    );
    expect(inferred).toContain('done (inferred from the diff)');
    const redone = formatStageEvidenceReceipt(fold([stage('development', 'redone')]));
    expect(redone).toContain('done (redone)');
  });

  it('renders failed / running / skipped / missing with the right glyphs', () => {
    const out = formatStageEvidenceReceipt(
      fold([
        stage('planning', 'failed'),
        stage('specification', 'running'),
        stage('review', 'skipped'),
        stage('development', 'missing'),
      ]),
    );
    expect(out).toContain(`${PAQAD_STATUS_GLYPH.failed} planning — failed`);
    expect(out).toContain(`${PAQAD_STATUS_GLYPH.needsLook} specification — started, not finished`);
    expect(out).toContain(`${PAQAD_STATUS_GLYPH.skipped} review — skipped`);
    expect(out).toContain(`${PAQAD_STATUS_GLYPH.needsLook} development — not recorded`);
  });

  it('omits an optional stage that never ran, includes one that did', () => {
    const out = formatStageEvidenceReceipt(
      fold([
        stage('ticket_intake', 'missing', { started_at: null }),
        stage('delivery', 'complete'),
      ]),
    );
    expect(out).not.toContain('ticket_intake');
    expect(out).not.toContain('ticket intake');
    expect(out).toContain('delivery — done');
  });

  it('renders a not-applicable stage as ⚪ not applicable', () => {
    const out = formatStageEvidenceReceipt(fold([stage('development', 'not-applicable')]));
    expect(out).toContain(`${PAQAD_STATUS_GLYPH.skipped} development — not applicable`);
  });

  it('flags an inferred-artifact provenance', () => {
    const out = formatStageEvidenceReceipt(
      fold([stage('specification', 'complete', { evidence_source: 'inferred-artifact' })]),
    );
    expect(out).toContain('done (inferred from an artifact)');
  });

  it('returns empty string when nothing is worth showing', () => {
    expect(
      formatStageEvidenceReceipt(fold([stage('ticket_intake', 'missing', { started_at: null })])),
    ).toBe('');
  });

  describe('checks honesty', () => {
    it('downgrades a "done" checks stage to 🟡 when no passing report backs it (checksVerified=false)', () => {
      const out = formatStageEvidenceReceipt(fold([stage('checks', 'complete')]), false);
      expect(out).toContain(`${PAQAD_STATUS_GLYPH.needsLook} checks — marked — tests not verified`);
      expect(out).toContain('paqad-ai checks run');
      expect(out).not.toContain(`${PAQAD_STATUS_GLYPH.good} checks — done`);
    });

    it('keeps a "done" checks stage 🟢 when a report backs it (checksVerified=true)', () => {
      const out = formatStageEvidenceReceipt(fold([stage('checks', 'complete')]), true);
      expect(out).toContain(`${PAQAD_STATUS_GLYPH.good} checks — done`);
    });

    it('leaves the checks line unchanged when the signal is unknown (undefined)', () => {
      const out = formatStageEvidenceReceipt(fold([stage('checks', 'complete')]));
      expect(out).toContain(`${PAQAD_STATUS_GLYPH.good} checks — done`);
    });

    it('never dresses UP a non-done checks stage (a failed stage stays failed even if unverified)', () => {
      const out = formatStageEvidenceReceipt(fold([stage('checks', 'failed')]), false);
      expect(out).toContain(`${PAQAD_STATUS_GLYPH.failed} checks — failed`);
    });

    it('does not touch non-checks stages when checksVerified=false', () => {
      const out = formatStageEvidenceReceipt(fold([stage('planning', 'complete')]), false);
      expect(out).toContain(`${PAQAD_STATUS_GLYPH.good} planning — done`);
    });
  });
});

describe('composeChangeReceipt', () => {
  it('joins the verdict headline with the per-stage block', () => {
    const receipt = composeChangeReceipt({
      verdictSummary: '**▸ paqad** · Safe to merge',
      fold: fold([stage('planning', 'complete')]),
    });
    expect(receipt).toContain('Safe to merge');
    expect(receipt).toContain('planning — done');
  });

  it('is just the verdict when there is no fold', () => {
    const receipt = composeChangeReceipt({
      verdictSummary: '**▸ paqad** · Safe to merge',
      fold: null,
    });
    expect(receipt).toBe('**▸ paqad** · Safe to merge');
  });

  it('names the tech debt the change raised, and adds nothing when it raised none', () => {
    const receipt = composeChangeReceipt({
      verdictSummary: '**▸ paqad** · Safe to merge',
      fold: null,
      techDebt: [{ id: 'TD-A' }, { id: 'TD-B' }],
    });
    expect(receipt).toContain('> 🟡 tech debt: 2 item(s) raised (TD-A, TD-B)');
    for (const techDebt of [[], null, undefined]) {
      expect(composeChangeReceipt({ verdictSummary: 'v', fold: null, techDebt })).toBe('v');
    }
  });

  it('shows one amber line per rule override, and none without overrides', () => {
    const receipt = composeChangeReceipt({
      verdictSummary: 'v',
      fold: null,
      ruleOverrides: [
        { rule: 'RL-1', file: 'src/a.ts', by: 'human', at: '2026-10-20T10:00:00.000Z' },
        { rule: 'RL-2', file: 'src/b.ts', by: 'human', at: '2026-10-20T11:00:00.000Z' },
      ],
    });
    expect(receipt.split('\n').slice(1)).toEqual([
      '> 🟡 rule override: RL-1 on src/a.ts by human at 2026-10-20T10:00:00.000Z',
      '> 🟡 rule override: RL-2 on src/b.ts by human at 2026-10-20T11:00:00.000Z',
    ]);
    for (const ruleOverrides of [[], null, undefined]) {
      expect(composeChangeReceipt({ verdictSummary: 'v', fold: null, ruleOverrides })).toBe('v');
    }
  });

  it('adds one fix-proof line for a fix change only', () => {
    const line = (fixProof: Parameters<typeof composeChangeReceipt>[0]['fixProof']) =>
      composeChangeReceipt({ verdictSummary: 'v', fold: null, fixProof }).split('\n').slice(1);
    expect(line({ required: true, state: 'red-green' })).toEqual([
      '> 🟢 fix proof: fails before the fix, passes after',
    ]);
    expect(line({ required: true, state: 'none' })).toEqual(['> 🟡 fix proof: no proof recorded']);
    expect(line({ required: false, state: 'none' })).toEqual([
      '> ⚪ fix proof: not required (only tests, docs or comments changed)',
    ]);
    expect(line(null)).toEqual([]);
  });

  it('appends an optional delivery line', () => {
    const receipt = composeChangeReceipt({
      verdictSummary: '**▸ paqad** · Safe to merge',
      fold: null,
      delivery: '🟢 delivery: on feat/x, PR open, CI green',
    });
    expect(receipt).toContain('> 🟢 delivery: on feat/x');
  });

  it('names the report path when one was rendered', () => {
    const receipt = composeChangeReceipt({
      verdictSummary: '**▸ paqad** · Safe to merge',
      fold: null,
      reportPath: '/abs/path/report.html',
    });
    expect(receipt).toContain('> Report: /abs/path/report.html');
  });

  it('threads checksVerified=false through to the stage block', () => {
    const receipt = composeChangeReceipt({
      verdictSummary: '**▸ paqad** · Inconclusive',
      fold: fold([stage('checks', 'complete')]),
      checksVerified: false,
    });
    expect(receipt).toContain('tests not verified');
  });

  it('appends the change-shape line when metrics are supplied', () => {
    const receipt = composeChangeReceipt({
      verdictSummary: '**▸ paqad** · Safe to merge',
      fold: null,
      changeMetrics: {
        dup_new_pct: 0,
        reuse_rate: 4.2,
        meaningful_changed_lines: 100,
        inputs: {
          flagged_lines: 0,
          reuse_calls: 4,
          duplication_report_present: true,
          index_present: true,
        },
      },
    });
    expect(receipt).toContain(
      '> - 📏 change shape: 0% duplicated new code · 4.2 reuse calls /100 lines',
    );
  });

  it('omits the change-shape line when no metrics are supplied (non-feature-dev)', () => {
    const receipt = composeChangeReceipt({
      verdictSummary: '**▸ paqad** · Safe to merge',
      fold: null,
      changeMetrics: null,
    });
    expect(receipt).not.toContain('change shape');
  });

  it('suffixes the planning line with the declared reuse counts', () => {
    const receipt = composeChangeReceipt({
      verdictSummary: '**▸ paqad** · Safe to merge',
      fold: fold([stage('planning', 'complete')]),
      reuse: { reused: 1, newJustified: 2 },
    });
    expect(receipt).toContain('planning — done (reuse: 1 reused, 2 new justified)');
  });

  it('leaves the planning line unchanged for a plan compiled before the reuse gate', () => {
    const withoutReuse = composeChangeReceipt({
      verdictSummary: '**▸ paqad** · Safe to merge',
      fold: fold([stage('planning', 'complete')]),
    });
    expect(withoutReuse).toContain('planning — done');
    expect(withoutReuse).not.toContain('reuse:');
    expect(
      composeChangeReceipt({
        verdictSummary: '**▸ paqad** · Safe to merge',
        fold: fold([stage('planning', 'complete')]),
        reuse: null,
      }),
    ).toBe(withoutReuse);
  });

  it('never suffixes a stage other than planning', () => {
    const receipt = composeChangeReceipt({
      verdictSummary: '**▸ paqad** · Safe to merge',
      fold: fold([stage('development', 'complete')]),
      reuse: { reused: 1, newJustified: 0 },
    });
    expect(receipt).not.toContain('reuse:');
  });
});

describe('unrecordedMandatoryStages', () => {
  it('returns the mandatory stages that are not provably done, excluding optional/skipped', () => {
    const gaps = unrecordedMandatoryStages(
      fold([
        stage('planning', 'complete'),
        stage('specification', 'complete'),
        stage('development', 'complete', { evidence_source: 'inferred-git' }),
        stage('review', 'missing'),
        stage('checks', 'missing'),
        stage('documentation_sync', 'complete'),
        stage('delivery', 'skipped'),
      ]),
    );
    expect(gaps).toEqual(['review', 'checks']);
  });

  it('counts an inconclusive or failed mandatory stage as a gap', () => {
    const gaps = unrecordedMandatoryStages(
      fold([
        stage('planning', 'inconclusive'),
        stage('specification', 'failed'),
        stage('development', 'complete'),
      ]),
    );
    expect(gaps).toEqual(['planning', 'specification']);
  });

  it('excludes a not-applicable mandatory stage', () => {
    expect(unrecordedMandatoryStages(fold([stage('development', 'not-applicable')]))).toEqual([]);
  });

  it('treats a checks stage the completion gate could not verify as a gap (checksVerified=false)', () => {
    expect(unrecordedMandatoryStages(fold([stage('checks', 'complete')]), false)).toEqual([
      'checks',
    ]);
    expect(unrecordedMandatoryStages(fold([stage('checks', 'complete')]), true)).toEqual([]);
  });

  it('returns [] when every mandatory stage is provably done', () => {
    const gaps = unrecordedMandatoryStages(
      fold([
        stage('planning', 'complete'),
        stage('specification', 'complete'),
        stage('development', 'complete'),
        stage('review', 'complete'),
        stage('checks', 'complete'),
        stage('documentation_sync', 'complete'),
      ]),
      true,
    );
    expect(gaps).toEqual([]);
  });

  it('composes a self-consistent receipt: Inconclusive headline agrees with the 🟡 stage lines', () => {
    const repro = fold([
      stage('planning', 'complete'),
      stage('specification', 'complete'),
      stage('development', 'complete', { evidence_source: 'inferred-git' }),
      stage('review', 'missing'),
      stage('checks', 'missing'),
      stage('documentation_sync', 'complete'),
    ]);
    const gaps = unrecordedMandatoryStages(repro);
    const reconciledHeadline = formatVerdictSummary({
      ok: true,
      gates: [{ gate: 'change-completeness', status: 'pass', detail: 'ok', remediation: null }],
      escalations: [],
      unrecordedMandatoryStages: gaps,
    });
    const receipt = composeChangeReceipt({ verdictSummary: reconciledHeadline, fold: repro });

    expect(receipt).toContain(paqadFrameLead(PAQAD_VERDICT.inconclusive));
    expect(receipt).not.toContain(PAQAD_VERDICT.pass);
    expect(receipt).toContain(`${PAQAD_STATUS_GLYPH.needsLook} review — not recorded`);
    expect(receipt).toContain(`${PAQAD_STATUS_GLYPH.needsLook} checks — not recorded`);
    expect(receipt).toContain('No record yet for: Review, Checks');
  });
});
