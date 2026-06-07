import { DECISION_CATEGORY_DEFAULTS, type DecisionPacket } from '@/planning/decision-packet.js';
import { sha256Hex } from '@/compliance/markdown.js';

export interface SpecDecisionInput {
  decision_id: string;
  spec_id: string;
  spec_file: string;
  /** What changed (for spec.change) or how work conflicts with the spec (for spec.contradiction). */
  detail: string;
  task_session_id: string;
  created_at: string;
  requested_by?: string;
}

const DEFAULT_REQUESTED_BY = 'spec-stage';

/**
 * Builds the Decision Packet raised when a real mid-build goal change is
 * detected. The recommendation is to update the spec and re-freeze — goals
 * never drift quietly (issue #102 Settled decision).
 */
export function buildSpecChangePacket(input: SpecDecisionInput): DecisionPacket {
  return buildPacket('spec.change', input, {
    question: 'The goal changed mid-build. Update the frozen spec and re-freeze, or keep it as-is?',
    options: [
      {
        option_key: 'update-and-refreeze',
        label: 'Update spec and re-freeze',
        one_line_preview: `We will amend ${input.spec_file}, re-confirm invariants, and re-freeze.`,
        trade_off: 'You give up: the original frozen target — the new goal becomes the bar.',
      },
      {
        option_key: 'keep-current-spec',
        label: 'Keep the current frozen spec',
        one_line_preview: 'We will keep building to the spec already frozen.',
        trade_off: 'You give up: capturing the new goal — the change is deferred.',
      },
    ],
    recommendation: 'update-and-refreeze',
    recommendation_reason:
      'A real goal change must update the spec and re-freeze before work continues.',
  });
}

/**
 * Builds the Decision Packet raised when the work contradicts the frozen spec.
 * It offers exactly "fix code" or "change spec" with no recommendation — the
 * agent never silently resolves a contradiction (issue #102 Settled decision).
 */
export function buildSpecContradictionPacket(input: SpecDecisionInput): DecisionPacket {
  return buildPacket('spec.contradiction', input, {
    question:
      'The work contradicts the frozen spec. Fix the code to match the spec, or change the spec?',
    options: [
      {
        option_key: 'fix-code',
        label: 'Fix the code to match the spec',
        one_line_preview: 'We will change the implementation so it satisfies the frozen spec.',
        trade_off: 'You give up: the current implementation behaviour.',
      },
      {
        option_key: 'change-spec',
        label: 'Change the spec to match the work',
        one_line_preview: `We will amend ${input.spec_file} and re-freeze to the new behaviour.`,
        trade_off: 'You give up: the originally frozen behaviour.',
      },
    ],
    recommendation: null,
    recommendation_reason: undefined,
  });
}

function buildPacket(
  category: 'spec.change' | 'spec.contradiction',
  input: SpecDecisionInput,
  shape: {
    question: string;
    options: Array<{
      option_key: string;
      label: string;
      one_line_preview: string;
      trade_off: string;
    }>;
    recommendation: string | null;
    recommendation_reason: string | undefined;
  },
): DecisionPacket {
  const ttlDays = DECISION_CATEGORY_DEFAULTS[category].ttl_days;
  const ttlUntil = new Date(
    new Date(input.created_at).getTime() + ttlDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const fingerprint = `sha256:${sha256Hex(`${category}:${input.spec_id}:${input.detail}`)}`;

  const packet: DecisionPacket = {
    decision_id: input.decision_id,
    fingerprint,
    category,
    question: shape.question,
    context: `Spec ${input.spec_id} (${input.spec_file}). ${input.detail}`,
    options: shape.options.map((option) => ({ ...option, evidence: {} })),
    confidence: 0.5,
    requested_by: input.requested_by ?? DEFAULT_REQUESTED_BY,
    task_session_id: input.task_session_id,
    linked_requirements: [],
    created_at: input.created_at,
    status: 'pending',
    ttl_until: ttlUntil,
    invalidation_watch: [input.spec_file],
  };

  if (shape.recommendation !== null) {
    packet.recommendation = shape.recommendation;
    packet.recommendation_reason = shape.recommendation_reason;
  }

  return packet;
}
