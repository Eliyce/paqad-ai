// Discovery stage-local context receipts (issue #597, DW-11).
//
// Records an honest receipt of the context made available/read/acknowledged on stage entry. It
// enforces the contract's two rules: the mode must be one of the honest values (never "understood"),
// and any context beyond the stage's bounded default set is allowed ONLY with a recorded reason.
// The receipt is a claim about what was loaded, not about comprehension.

import { appendContextReceipt, type DiscoveryWriteContext } from './writers.js';
import { extraContextItems, isContextMode, type ContextMode } from './context-contract.js';

export interface RecordContextReceiptInput {
  stage: string;
  /** The context items made available/read for the stage. */
  items: string[];
  mode: ContextMode;
  /** Why context beyond the stage's bounded default was loaded; required when there is extra. */
  reason?: string | null;
}

export interface ContextReceiptResult {
  ok: boolean;
  /** The items loaded beyond the stage's bounded default (informational). */
  extra: string[];
  error?: string;
}

/**
 * Validate and record a stage-local context receipt. Refuses (without writing) when the mode is not
 * an honest value, or when extra context was loaded with no reason (DW-11). On success it appends a
 * row to `context-receipts.jsonl` and returns the extra items it recorded.
 */
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
