import { appendContextReceipt, type DiscoveryWriteContext } from './writers.js';
import { extraContextItems, isContextMode, type ContextMode } from './context-contract.js';

export interface RecordContextReceiptInput {
  stage: string;
  items: string[];
  mode: ContextMode;
  reason?: string | null;
}

export interface ContextReceiptResult {
  ok: boolean;
  extra: string[];
  error?: string;
}

export function recordContextReceipt(
  ctx: DiscoveryWriteContext,
  input: RecordContextReceiptInput,
): ContextReceiptResult {
  if (!isContextMode(input.mode)) {
    return {
      ok: false,
      extra: [],
      error: `mode "${input.mode}" is not one of available|read|acknowledged`,
    };
  }
  const extra = extraContextItems(input.stage, input.items);
  const reason = input.reason?.trim() ?? '';
  if (extra.length > 0 && reason.length === 0) {
    return {
      ok: false,
      extra,
      error: `loading context beyond the stage default (${extra.join(', ')}) needs a recorded reason`,
    };
  }
  appendContextReceipt(ctx, {
    stage: input.stage,
    items: input.items,
    mode: input.mode,
    reason: extra.length > 0 ? reason : null,
  });
  return { ok: true, extra };
}
