import { describe, expect, it } from 'vitest';

import { PAQAD_STATUS_GLYPH } from '@/core/constants/paqad-voice.js';
import {
  composeChangeReceipt,
  formatStageEvidenceReceipt,
} from '@/verification/repository/receipt.js';
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
});
