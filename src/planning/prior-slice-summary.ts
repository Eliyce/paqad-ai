import type { PriorSliceSummary, SliceCheckpoint } from '@/core/types/planning.js';

export function summarizeCheckpoint(checkpoint: SliceCheckpoint): PriorSliceSummary {
  return {
    slice_id: checkpoint.slice_id,
    goal: checkpoint.goal,
    status: checkpoint.status,
    files_changed: checkpoint.files_changed,
    exports_available: checkpoint.exports_created,
  };
}

export function estimatePriorSliceSummaryTokens(summary: PriorSliceSummary): number {
  const payload = JSON.stringify(summary);
  return Math.ceil(payload.length / 4);
}
