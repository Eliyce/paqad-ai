// End-of-change receipt composition (issue #325).
//
// The completion seam already holds every input for an honest end-of-change receipt
// — the trust verdict (verdict.ts) and the folded stage evidence (stage-evidence
// fold). This module composes them into ONE branded block: the verdict headline in
// contract words, then a per-stage line with a fixed glyph and an evidence note.
//
// The receipt never dresses up a claim. A stage that was only marked (no artifact,
// or a near-zero duration that proves no work happened) renders 🟡 "marked (no
// recorded work)", never 🟢 "done" — it reflects the fold's honesty tags verbatim.

import { PAQAD_STATUS_GLYPH } from '@/core/constants/paqad-voice.js';
import { isMandatoryStage } from '@/stage-evidence/stages.js';
import type { FoldedChange, FoldedStage } from '@/stage-evidence/types.js';

interface StageStatus {
  glyph: string;
  note: string;
}

/** Human-readable stage label (the underscore-free stage id). */
function stageLabel(stage: string): string {
  return stage.replace(/_/g, ' ');
}

/**
 * Map one folded stage to its receipt glyph + note. Honest by construction: a
 * complete stage with a near-zero (unreliable) duration, or an inconclusive stage
 * (a marker with no real artifact), never reads 🟢 "done".
 */
function stageStatus(stage: FoldedStage): StageStatus {
  switch (stage.state) {
    case 'complete':
    case 'redone': {
      if (stage.duration_unreliable) {
        return {
          glyph: PAQAD_STATUS_GLYPH.needsLook,
          note: 'marked (near-zero duration — no recorded work)',
        };
      }
      const base =
        stage.evidence_source === 'inferred-git'
          ? 'done (inferred from the diff)'
          : stage.evidence_source === 'inferred-artifact'
            ? 'done (inferred from an artifact)'
            : 'done';
      return {
        glyph: PAQAD_STATUS_GLYPH.good,
        note: stage.state === 'redone' ? `${base} (redone)` : base,
      };
    }
    case 'inconclusive':
      return { glyph: PAQAD_STATUS_GLYPH.needsLook, note: 'marked (no recorded work)' };
    case 'failed':
      return { glyph: PAQAD_STATUS_GLYPH.failed, note: 'failed' };
    case 'running':
      return { glyph: PAQAD_STATUS_GLYPH.needsLook, note: 'started, not finished' };
    case 'skipped':
      return { glyph: PAQAD_STATUS_GLYPH.skipped, note: 'skipped' };
    case 'not-applicable':
      return { glyph: PAQAD_STATUS_GLYPH.skipped, note: 'not applicable' };
    default:
      // 'missing' — a mandatory stage with no record is a gap, not a pass.
      return { glyph: PAQAD_STATUS_GLYPH.needsLook, note: 'not recorded' };
  }
}

/**
 * Render the per-stage evidence block: one line per mandatory stage, plus any
 * optional stage that actually ran (has a start). Returns '' when there is nothing
 * to show. Each line is a blockquote so it nests under the verdict headline.
 */
export function formatStageEvidenceReceipt(fold: FoldedChange): string {
  const rows = fold.stages.filter(
    (stage) => isMandatoryStage(stage.stage) || stage.started_at !== null,
  );
  if (rows.length === 0) {
    return '';
  }
  return rows
    .map((stage) => {
      const { glyph, note } = stageStatus(stage);
      return `> ${glyph} ${stageLabel(stage.stage)} — ${note}`;
    })
    .join('\n');
}

export interface ComposeChangeReceiptInput {
  /** The branded verdict block (from `formatVerdictSummary`). */
  verdictSummary: string;
  /** The folded stage evidence for the change, or null when none was recorded. */
  fold: FoldedChange | null;
  /** Optional one-line delivery state (branch/PR/CI), when available. */
  delivery?: string | null;
  /** Absolute path to the per-feature HTML report paqad wrote (issue #371), when one
   *  was rendered — surfaced so the developer can open the full evidence page. */
  reportPath?: string | null;
}

/**
 * Compose the single end-of-change receipt: the verdict headline + gate lines, then
 * the per-stage evidence block, then an optional delivery line. This is the one
 * message the completion seam surfaces (issue #325 — invert the cadence: one honest
 * receipt at the end, not duplicated per-stage chatter).
 */
export function composeChangeReceipt(input: ComposeChangeReceiptInput): string {
  const parts = [input.verdictSummary];
  if (input.fold) {
    const stageBlock = formatStageEvidenceReceipt(input.fold);
    if (stageBlock) {
      parts.push(stageBlock);
    }
  }
  if (input.delivery) {
    parts.push(`> ${input.delivery}`);
  }
  if (input.reportPath) {
    parts.push(`> Report: ${input.reportPath}`);
  }
  return parts.join('\n');
}
