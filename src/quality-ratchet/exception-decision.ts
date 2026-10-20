import { sha256Hex } from '@/compliance/markdown.js';
import { DECISION_CATEGORY_DEFAULTS, type DecisionPacket } from '@/planning/decision-packet.js';
import type { DecisionStore } from '@/planning/decision-store.js';

const CATEGORY = 'quality.ratchet_exception' as const;
const DEFAULT_REQUESTED_BY = 'quality-ratchet';

export const RATCHET_EXCEPTION_APPROVE = 'approve-exception';
export const RATCHET_EXCEPTION_REFUSE = 'hold-the-line';

export interface RatchetExceptionInput {
  decision_id: string;
  kind: string;
  measure: string;
  module: string;
  baseline_value: number | null;
  current_value: number | null;
  task_session_id: string;
  created_at: string;
  requested_by?: string;
}

export function buildRatchetExceptionPacket(input: RatchetExceptionInput): DecisionPacket {
  const ttlDays = DECISION_CATEGORY_DEFAULTS[CATEGORY].ttl_days;
  const ttlUntil = new Date(
    new Date(input.created_at).getTime() + ttlDays * 24 * 60 * 60 * 1000,
  ).toISOString();
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
