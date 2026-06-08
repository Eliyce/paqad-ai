// Issue #110 — the `quality.ratchet_exception` Decision Pause.
//
// When a measure must legitimately worsen, the ratchet does not silently bend:
// it pauses for human approval through the shipped Decision Pause Contract, and
// that approval is reused for same-kind regressions by kind (`findReusableDecision`
// → `decision-reused`). We build NO second memory — the DPC store is the memory.
//
// The fingerprint is keyed by the regression *kind* (the measure) and nothing
// finding-specific, so a strictness exception approved once is reused for the
// next strictness regression without re-asking (issue #107's settle-once,
// reuse-by-kind mechanism, applied to quality).

import { sha256Hex } from '@/compliance/markdown.js';
import { DECISION_CATEGORY_DEFAULTS, type DecisionPacket } from '@/planning/decision-packet.js';
import type { DecisionStore } from '@/planning/decision-store.js';

const CATEGORY = 'quality.ratchet_exception' as const;
const DEFAULT_REQUESTED_BY = 'quality-ratchet';

export const RATCHET_EXCEPTION_APPROVE = 'approve-exception';
export const RATCHET_EXCEPTION_REFUSE = 'hold-the-line';

export interface RatchetExceptionInput {
  decision_id: string;
  /** The regression kind (e.g. `quality.strictness`) — the reuse key. */
  kind: string;
  /** The measure that worsened, for the human-readable question. */
  measure: string;
  /** Where it worsened (module slug or project scope). */
  module: string;
  baseline_value: number | null;
  current_value: number | null;
  task_session_id: string;
  created_at: string;
  requested_by?: string;
}

/**
 * Build the Decision Packet raised when a measure worsens with no prior
 * approval. The human either approves the exception (recorded, reused by kind)
 * or holds the line (the change must bring the measure back). Option keys are
 * stable so a later same-kind regression reuses the saved verdict via the DPC.
 */
export function buildRatchetExceptionPacket(input: RatchetExceptionInput): DecisionPacket {
  const ttlDays = DECISION_CATEGORY_DEFAULTS[CATEGORY].ttl_days;
  const ttlUntil = new Date(
    new Date(input.created_at).getTime() + ttlDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  // Fingerprint by kind only so identical kinds match exactly and same-kind
  // regressions with different numbers still match fuzzily.
  const fingerprint = `sha256:${sha256Hex(`${CATEGORY}:${input.kind}`)}`;

  const from = input.baseline_value === null ? 'n/a' : String(input.baseline_value);
  const to = input.current_value === null ? 'n/a' : String(input.current_value);

  return {
    decision_id: input.decision_id,
    fingerprint,
    category: CATEGORY,
    question: `Allow ${input.measure} to worsen (${from} → ${to}) at ${input.module}?`,
    context:
      `The quality ratchet refuses any change that worsens a measure. ` +
      `${input.measure} at ${input.module} rose from ${from} to ${to} (lower is better). ` +
      `Approve only if this is a genuine, legitimate need — the approval is reused for the same kind.`,
    options: [
      {
        option_key: RATCHET_EXCEPTION_APPROVE,
        label: 'Make an exception',
        one_line_preview:
          'If you pick this, the worse level is recorded as the new baseline and reused for the same kind.',
        trade_off: 'You give up: holding the previous, stricter level for this measure.',
        evidence: {},
      },
      {
        option_key: RATCHET_EXCEPTION_REFUSE,
        label: 'Keep the current level',
        one_line_preview:
          'If you pick this, the change must bring the measure back to at least its recorded level.',
        trade_off: 'You give up: shipping the change until the measure is no longer worse.',
        evidence: {},
      },
    ],
    recommendation: RATCHET_EXCEPTION_REFUSE,
    recommendation_reason:
      'The ratchet defaults to holding the line; worsening a measure should be a deliberate, recorded exception.',
    confidence: 0.5,
    requested_by: input.requested_by ?? DEFAULT_REQUESTED_BY,
    task_session_id: input.task_session_id,
    linked_requirements: [],
    created_at: input.created_at,
    status: 'pending',
    ttl_until: ttlUntil,
    invalidation_watch: [],
  };
}

/**
 * For a set of candidate regression kinds, return those already approved as an
 * exception — reusing the saved decision by kind via `findReusableDecision`
 * (which emits `decision-reused`). A kind whose reusable decision chose
 * "hold the line" is NOT returned (the line still holds).
 *
 * `buildPacket` lets callers reuse the same packet shape the pause would write,
 * so the fingerprint and option keys match for the fuzzy reuse to fire.
 */
export function resolveReusableExceptionKinds(
  store: DecisionStore,
  kinds: Iterable<string>,
  buildPacket: (kind: string) => DecisionPacket,
): Set<string> {
  const approved = new Set<string>();
  for (const kind of new Set(kinds)) {
    const packet = buildPacket(kind);
    const reusableId = store.findReusableDecision({
      fingerprint: packet.fingerprint,
      category: packet.category,
      options: packet.options,
    });
    if (!reusableId) continue;
    const resolved = store.readResolved(reusableId);
    if (resolved?.human_response?.chosen_option_key === RATCHET_EXCEPTION_APPROVE) {
      approved.add(kind);
    }
  }
  return approved;
}
