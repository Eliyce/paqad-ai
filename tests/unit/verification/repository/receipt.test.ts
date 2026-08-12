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

describe('formatStageEvidenceReceipt (#325)', () => {
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

  describe('checks honesty (#368, AC-A2)', () => {
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

describe('composeChangeReceipt (#325)', () => {
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

  it('appends an optional delivery line', () => {
    const receipt = composeChangeReceipt({
      verdictSummary: '**▸ paqad** · Safe to merge',
      fold: null,
      delivery: '🟢 delivery: on feat/x, PR open, CI green',
    });
    expect(receipt).toContain('> 🟢 delivery: on feat/x');
  });

  it('names the report path when one was rendered (AC-8, #371)', () => {
    const receipt = composeChangeReceipt({
      verdictSummary: '**▸ paqad** · Safe to merge',
      fold: null,
      reportPath: '/abs/path/report.html',
    });
    expect(receipt).toContain('> Report: /abs/path/report.html');
  });

  it('threads checksVerified=false through to the stage block (#368)', () => {
    const receipt = composeChangeReceipt({
      verdictSummary: '**▸ paqad** · Inconclusive',
      fold: fold([stage('checks', 'complete')]),
      checksVerified: false,
    });
    expect(receipt).toContain('tests not verified');
  });

  // Issue #362 — the change-shape line renders only when metrics are supplied.
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

  // Issue #357 (AC-5) — the planning line shows what the plan declared it reused.
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
    // An explicit null is the same as omitting it.
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

describe('unrecordedMandatoryStages (#472)', () => {
  it('returns the mandatory stages that are not provably done, excluding optional/skipped', () => {
    const gaps = unrecordedMandatoryStages(
      fold([
        stage('planning', 'complete'),
        stage('specification', 'complete'),
        stage('development', 'complete', { evidence_source: 'inferred-git' }),
        stage('review', 'missing'),
        stage('checks', 'missing'),
        stage('documentation_sync', 'complete'),
        // A skipped mandatory stage is intentional non-work → not a gap.
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
    // A "done" checks marker with no passing report → 🟡, so it is a gap.
    expect(unrecordedMandatoryStages(fold([stage('checks', 'complete')]), false)).toEqual([
      'checks',
    ]);
    // With a passing report it is provably done → not a gap.
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

  // AC-5 — the exact #472 repro: a passing verdict + unrecorded review/checks must not
  // render "Safe to merge" beside 🟡 stage lines. The reconciled headline agrees with the block.
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

    // Headline is honest and never contradicts the block.
    expect(receipt).toContain(paqadFrameLead(PAQAD_VERDICT.inconclusive));
    expect(receipt).not.toContain(PAQAD_VERDICT.pass);
    // The block still shows the two unrecorded stages 🟡.
    expect(receipt).toContain(`${PAQAD_STATUS_GLYPH.needsLook} review — not recorded`);
    expect(receipt).toContain(`${PAQAD_STATUS_GLYPH.needsLook} checks — not recorded`);
    // The stages the headline names are exactly the ones the block flags.
    expect(receipt).toContain('mandatory stage(s) not recorded: review, checks');
  });
});
