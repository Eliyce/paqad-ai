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
import type { ReuseCounts } from '@/feature-evidence/reuse.js';
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
 * Downgrade an otherwise-"done" `checks` stage when no passing checks report backs it
 * (issue #368, AC-A2). A `checks` marker only proves the agent SAID it ran the gates;
 * the real pass/fail signal is a `paqad-ai checks run` report. So when `checksVerified`
 * is explicitly false, a good/🟢 `checks` line becomes 🟡 "tests not verified" — the
 * stage can never read as done on an unproven claim. Any non-good state (failed,
 * running, missing) already tells the truth and is left untouched, as is an unknown
 * (`undefined`) signal — callers that do not compute it keep the prior rendering.
 */
function applyChecksHonesty(
  stage: FoldedStage,
  status: StageStatus,
  checksVerified: boolean | undefined,
): StageStatus {
  if (stage.stage !== 'checks' || checksVerified !== false) {
    return status;
  }
  if (status.glyph !== PAQAD_STATUS_GLYPH.good) {
    return status;
  }
  return {
    glyph: PAQAD_STATUS_GLYPH.needsLook,
    note: 'marked — tests not verified (run `paqad-ai checks run`)',
  };
}

/**
 * Render the per-stage evidence block: one line per mandatory stage, plus any
 * optional stage that actually ran (has a start). Returns '' when there is nothing
 * to show. Each line is a blockquote so it nests under the verdict headline.
 *
 * `checksVerified` (issue #368) reflects whether a passing `paqad-ai checks run` report
 * backs the change; `false` downgrades a "done" `checks` line so tests can never read as
 * verified when they were not (AC-A2). `undefined` leaves rendering unchanged.
 */
export function formatStageEvidenceReceipt(
  fold: FoldedChange,
  checksVerified?: boolean,
  reuse?: ReuseCounts | null,
): string {
  const rows = fold.stages.filter(
    (stage) => isMandatoryStage(stage.stage) || stage.started_at !== null,
  );
  if (rows.length === 0) {
    return '';
  }
  return rows
    .map((stage) => {
      const { glyph, note } = applyChecksHonesty(stage, stageStatus(stage), checksVerified);
      return `> ${glyph} ${stageLabel(stage.stage)} — ${note}${reuseSuffix(stage, reuse)}`;
    })
    .join('\n');
}

/**
 * The planning line's reuse suffix (issue #357, AC-5) — `(reuse: 1 reused, 1 new
 * justified)`. Only the `planning` line carries it, and only when the plan actually
 * declared a reuse section: a plan compiled before the reuse gate existed renders exactly
 * as it did before, so the receipt never implies a check that did not happen.
 */
function reuseSuffix(stage: FoldedStage, reuse: ReuseCounts | null | undefined): string {
  if (stage.stage !== 'planning' || !reuse) {
    return '';
  }
  return ` (reuse: ${reuse.reused} reused, ${reuse.newJustified} new justified)`;
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
  /** Whether a passing `paqad-ai checks run` report backs this change (issue #368).
   *  `false` downgrades a "done" `checks` stage line so tests never read as verified
   *  when they were not (AC-A2). `undefined` leaves the `checks` line unchanged. */
  checksVerified?: boolean;
  /** The reuse counts the active feature's plan declared (issue #357), or null when it
   *  declared none — which is the case for any plan compiled before the reuse gate. */
  reuse?: ReuseCounts | null;
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
    const stageBlock = formatStageEvidenceReceipt(
      input.fold,
      input.checksVerified,
      input.reuse ?? null,
    );
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
