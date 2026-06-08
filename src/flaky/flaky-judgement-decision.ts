import { sha256Hex } from '@/compliance/markdown.js';
import { DECISION_CATEGORY_DEFAULTS, type DecisionPacket } from '@/planning/decision-packet.js';

export interface FlakyJudgementInput {
  decision_id: string;
  /** The test under judgement (stable id from `test-output/service.ts`). */
  test_id: string;
  /**
   * The *kind* of ambiguity (e.g. "rare-timeout", "intermittent-network"). The
   * packet's options are stable per kind, so two same-kind cases produce
   * overlapping packets — `findReusableDecision` matches them and the earlier
   * answer is reused (issue #106: ask once, remember by kind). The specific
   * test detail is kept out of the fingerprint so the same kind reuses.
   */
  kind: string;
  /** Test-specific detail (flip counts, suspected cause). Not fingerprinted. */
  detail: string;
  task_session_id: string;
  created_at: string;
  requested_by?: string;
}

const DEFAULT_REQUESTED_BY = 'flaky-detector';
const CATEGORY = 'test.flaky_judgement' as const;

/**
 * Builds the Decision Packet raised when a failure flipped just once and could
 * genuinely be a rare *real* intermittent fault rather than test flakiness
 * (issue #106 open decision #2). Auto-quarantine handles clear flips; this asks
 * the human only for the ambiguous case, once per kind. The option keys are
 * stable so a later same-kind case reuses the saved answer via the Decision
 * Pause Contract — it does not build a second memory.
 */
export function buildFlakyJudgementPacket(input: FlakyJudgementInput): DecisionPacket {
  const ttlDays = DECISION_CATEGORY_DEFAULTS[CATEGORY].ttl_days;
  const ttlUntil = new Date(
    new Date(input.created_at).getTime() + ttlDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  // Fingerprint by kind only so identical kinds get an exact match and differing
  // details of the same kind still match fuzzily.
  const fingerprint = `sha256:${sha256Hex(`${CATEGORY}:${input.kind}`)}`;

  return {
    decision_id: input.decision_id,
    fingerprint,
    category: CATEGORY,
    question: 'Is this a flaky test or a rare real fault?',
    context: `Test ${input.test_id}. This failure flipped only rarely (${input.kind}), so it could be a real intermittent fault rather than flakiness. ${input.detail}`,
    options: [
      {
        option_key: 'quarantine-as-flaky',
        label: 'Skip it as flaky',
        one_line_preview:
          'If you pick this, we set the test aside as flaky — it stops blocking but stays tracked for a fix.',
        trade_off: 'You give up: blocking on this test until its root cause is fixed.',
        evidence: {},
      },
      {
        option_key: 'keep-as-real-fault',
        label: 'Keep as real fault',
        one_line_preview:
          'If you pick this, the failure keeps blocking and we look for a genuine on-and-off bug.',
        trade_off: 'You give up: progress until the on-and-off fault is found.',
        evidence: {},
      },
      {
        option_key: 'gather-more-reruns',
        label: 'Take more re-runs',
        one_line_preview:
          'If you pick this, we re-run the test more times to gather clearer pass and fail evidence first.',
        trade_off: 'You give up: a quick decision, in exchange for stronger evidence.',
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
