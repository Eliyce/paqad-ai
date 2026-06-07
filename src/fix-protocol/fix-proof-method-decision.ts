import { sha256Hex } from '@/compliance/markdown.js';
import { DECISION_CATEGORY_DEFAULTS, type DecisionPacket } from '@/planning/decision-packet.js';

export interface FixProofMethodInput {
  decision_id: string;
  defect_id: string;
  /**
   * The *kind* of un-checkable problem (e.g. "visual-appearance", "timing").
   * The packet's options are stable per call, so two defects of the same kind
   * produce overlapping packets — `findReusableDecision` matches them and the
   * earlier answer is reused (issue #103: ask once, remember by kind).
   */
  kind: string;
  /** Defect-specific detail. Kept out of the fingerprint so the same kind reuses. */
  detail: string;
  task_session_id: string;
  created_at: string;
  requested_by?: string;
}

const DEFAULT_REQUESTED_BY = 'fix-protocol';
const CATEGORY = 'fix.proof_method' as const;

/**
 * Builds the Decision Packet raised when a confirmed problem genuinely cannot
 * be auto-checked (timing, visual appearance). It asks the human *how* to
 * confirm this kind of problem. The option keys are stable so a later
 * same-kind case reuses the saved answer via the Decision Pause Contract — it
 * does not build a second memory (issue #103 Settled decision).
 */
export function buildFixProofMethodPacket(input: FixProofMethodInput): DecisionPacket {
  const ttlDays = DECISION_CATEGORY_DEFAULTS[CATEGORY].ttl_days;
  const ttlUntil = new Date(
    new Date(input.created_at).getTime() + ttlDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  // Fingerprint by kind only (not the specific defect) so identical kinds get
  // an exact match and differing details of the same kind still match fuzzily.
  const fingerprint = `sha256:${sha256Hex(`${CATEGORY}:${input.kind}`)}`;

  return {
    decision_id: input.decision_id,
    fingerprint,
    category: CATEGORY,
    question: 'How should we confirm this problem is fixed?',
    context: `Defect ${input.defect_id}. This kind of problem (${input.kind}) cannot be auto-checked. ${input.detail}`,
    options: [
      {
        option_key: 'human-verification-step',
        label: 'Use a manual check',
        one_line_preview: 'If you pick this, a person runs a set check to confirm the fix.',
        trade_off: 'You give up: a fully automated check.',
        evidence: {},
      },
      {
        option_key: 'recorded-baseline-snapshot',
        label: 'Keep an approved snapshot',
        one_line_preview:
          'If you pick this, we save an approved snapshot and compare later runs to it.',
        trade_off: 'You give up: free changes without re-approving the snapshot.',
        evidence: {},
      },
      {
        option_key: 'measured-threshold',
        label: 'Use a measured limit',
        one_line_preview: 'If you pick this, we check a measured value against a set limit.',
        trade_off: 'You give up: cases the chosen value does not catch.',
        evidence: {},
      },
    ],
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
