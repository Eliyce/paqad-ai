import { formatChangeShapeLine } from '@/change-metrics/index.js';
import type { ChangeMetrics } from '@/change-metrics/index.js';
import { PAQAD_STATUS_GLYPH } from '@/core/constants/paqad-voice.js';
import type { ReuseCounts } from '@/feature-evidence/reuse.js';
import { isMandatoryStage } from '@/stage-evidence/stages.js';
import type { FoldedChange, FoldedStage } from '@/stage-evidence/types.js';
import {
  formatStageIsolationLine,
  type StageIsolationSummary,
} from '@/stage-isolation/isolation-summary.js';

interface StageStatus {
  glyph: string;
  note: string;
}

function stageLabel(stage: string): string {
  return stage.replace(/_/g, ' ');
}

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
      return { glyph: PAQAD_STATUS_GLYPH.needsLook, note: 'not recorded' };
  }
}

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

export function unrecordedMandatoryStages(fold: FoldedChange, checksVerified?: boolean): string[] {
  return fold.stages
    .filter((stage) => isMandatoryStage(stage.stage))
    .filter((stage) => {
      const { glyph } = applyChecksHonesty(stage, stageStatus(stage), checksVerified);
      return glyph === PAQAD_STATUS_GLYPH.needsLook || glyph === PAQAD_STATUS_GLYPH.failed;
    })
    .map((stage) => stage.stage);
}

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

function reuseSuffix(stage: FoldedStage, reuse: ReuseCounts | null | undefined): string {
  if (stage.stage !== 'planning' || !reuse) {
    return '';
  }
  return ` (reuse: ${reuse.reused} reused, ${reuse.newJustified} new justified)`;
}

export interface ComposeChangeReceiptInput {
  verdictSummary: string;
  fold: FoldedChange | null;
  delivery?: string | null;
  reportPath?: string | null;
  checksVerified?: boolean;
  reuse?: ReuseCounts | null;
  changeMetrics?: ChangeMetrics | null;
  isolation?: StageIsolationSummary | null;
  techDebt?: readonly { id: string }[] | null;
  ruleOverrides?: readonly { rule: string; file: string; by: string; at: string }[] | null;
}

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
  if (input.changeMetrics) {
    parts.push(formatChangeShapeLine(input.changeMetrics));
  }
  if (input.isolation) {
    parts.push(`> ${formatStageIsolationLine(input.isolation)}`);
  }
  if (input.techDebt && input.techDebt.length > 0) {
    parts.push(
      `> ${PAQAD_STATUS_GLYPH.needsLook} tech debt: ${input.techDebt.length} item(s) raised (${input.techDebt.map((item) => item.id).join(', ')})`,
    );
  }
  for (const override of input.ruleOverrides ?? []) {
    parts.push(
      `> ${PAQAD_STATUS_GLYPH.needsLook} rule override: ${override.rule} on ${override.file} by ${override.by} at ${override.at}`,
    );
  }
  if (input.delivery) {
    parts.push(`> ${input.delivery}`);
  }
  if (input.reportPath) {
    parts.push(`> Report: ${input.reportPath}`);
  }
  return parts.join('\n');
}
