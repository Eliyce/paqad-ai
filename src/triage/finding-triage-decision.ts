import { sha256Hex } from '@/compliance/markdown.js';
import { DECISION_CATEGORY_DEFAULTS, type DecisionPacket } from '@/planning/decision-packet.js';
import type { TriagePile, TriageVerdict } from '@/core/types/triage.js';

export interface FindingTriageInput {
  decision_id: string;
  finding_id: string;
  kind: string;
  detail: string;
  task_session_id: string;
  created_at: string;
  requested_by?: string;
}

const DEFAULT_REQUESTED_BY = 'finding-triage';
const CATEGORY = 'finding.triage' as const;

export const TRIAGE_DECISION_OPTION_TO_PILE: Record<string, TriagePile> = {
  'confirmed-problem': 'confirmed',
  'unclear-spec': 'unclear-spec',
  'false-alarm': 'false-alarm',
  taste: 'taste',
};

export function buildFindingTriagePacket(input: FindingTriageInput): DecisionPacket {
  const ttlDays = DECISION_CATEGORY_DEFAULTS[CATEGORY].ttl_days;
  const ttlUntil = new Date(
    new Date(input.created_at).getTime() + ttlDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const fingerprint = `sha256:${sha256Hex(`${CATEGORY}:${input.kind}`)}`;

  return {
    decision_id: input.decision_id,
    fingerprint,
    category: CATEGORY,
    question: 'Which pile does this finding belong in?',
    context: `Finding ${input.finding_id} (${input.kind}) could not be sorted automatically. ${input.detail}`,
    options: [
      {
        option_key: 'confirmed-problem',
        label: 'Keep as a real problem',
        one_line_preview:
          'If you pick this, we treat it as a real problem and prove it before changing code.',
        trade_off: 'You give up: leaving the code as-is — it must now be reproduced and fixed.',
        evidence: {},
      },
      {
        option_key: 'unclear-spec',
        label: 'Make the spec clearer',
        one_line_preview:
          'If you pick this, it goes back to the spec to be clarified, not patched in code.',
        trade_off: 'You give up: a quick code edit, in exchange for fixing the spec at the source.',
        evidence: {},
      },
      {
        option_key: 'false-alarm',
        label: 'Skip as a false alarm',
        one_line_preview:
          'If you pick this, we set it aside with a recorded reason — no code change.',
        trade_off: 'You give up: acting on it, if it later turns out to be real.',
        evidence: {},
      },
      {
        option_key: 'taste',
        label: 'Keep the current style',
        one_line_preview:
          'If you pick this, we record it as a fine-either-way preference and do not act on it.',
        trade_off: 'You give up: changing the code to the alternative style.',
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

export function verdictFromTriageOption(findingId: string, optionKey: string): TriageVerdict {
  const pile = TRIAGE_DECISION_OPTION_TO_PILE[optionKey];
  /* v8 ignore next 8 -- defensive: a resolved packet always carries one of the stable keys */
  if (!pile) {
    return {
      finding_id: findingId,
      pile: null,
      ambiguous: true,
      route: 'ask-human',
      reason: `Unrecognized triage option "${optionKey}".`,
    };
  }
  switch (pile) {
    case 'confirmed':
      return {
        finding_id: findingId,
        pile,
        ambiguous: false,
        confirmation: 'needs-repro',
        route: 'await-repro',
        reason: 'Human-confirmed problem — hands off to the prove-it protocol before any change.',
      };
    case 'unclear-spec':
      return {
        finding_id: findingId,
        pile,
        ambiguous: false,
        route: 'spec',
        reason: 'Human routed this to the spec, not a code patch.',
      };
    case 'false-alarm':
      return {
        finding_id: findingId,
        pile,
        ambiguous: false,
        route: 'record',
        reason: 'Human set this aside as a false alarm.',
      };
    case 'taste':
      return {
        finding_id: findingId,
        pile,
        ambiguous: false,
        route: 'record',
        reason: 'Human judged this a matter of taste — recorded, not acted on.',
      };
  }
}
