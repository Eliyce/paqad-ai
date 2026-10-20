import { sha256Hex } from '@/compliance/markdown.js';
import { DECISION_CATEGORY_DEFAULTS, type DecisionPacket } from '@/planning/decision-packet.js';

export interface FixProofMethodInput {
  decision_id: string;
  defect_id: string;
  kind: string;
  detail: string;
  task_session_id: string;
  created_at: string;
  requested_by?: string;
}

const DEFAULT_REQUESTED_BY = 'fix-protocol';
const CATEGORY = 'fix.proof_method' as const;

export function buildFixProofMethodPacket(input: FixProofMethodInput): DecisionPacket {
  const ttlDays = DECISION_CATEGORY_DEFAULTS[CATEGORY].ttl_days;
  const ttlUntil = new Date(
    new Date(input.created_at).getTime() + ttlDays * 24 * 60 * 60 * 1000,
  ).toISOString();
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
