import { DECISION_CATEGORY_DEFAULTS, type DecisionPacket } from '@/planning/decision-packet.js';
import { DecisionStore } from '@/planning/decision-store.js';

import { RULES_PROPOSAL_CATEGORY } from './decisions.js';
import { runFilePath } from './paths.js';
import { rowWrites, signoffCounts, signoffQuestion, type Proposal } from './proposal.js';

export const SIGN_OFF = 'sign_off';
export const NOT_NOW = 'not_now';
const HASH_RE = /proposal\.json sha256: ([0-9a-f]{64})/;

export function signoffTaskId(runId: string): string {
  return `rules-discovery:${runId}`;
}

export function touchedRuleFiles(proposal: Proposal): string[] {
  return [
    ...new Set(proposal.rows.filter((row) => rowWrites(row) !== null).map((row) => row.target)),
  ].sort();
}

export function buildSignoffPacket(input: {
  decisionId: string;
  proposal: Proposal;
  proposalHash: string;
  now: Date;
}): DecisionPacket {
  const category = RULES_PROPOSAL_CATEGORY;
  const ttlDays = DECISION_CATEGORY_DEFAULTS[category].ttl_days;
  const created = input.now.toISOString();
  const runId = input.proposal.run_id;
  return {
    decision_id: input.decisionId,
    fingerprint: `sha256:${input.proposalHash}`,
    category,
    question: signoffQuestion(signoffCounts(input.proposal)),
    context: `Rules discovery run ${runId}. Every row of ${runFilePath(runId, 'proposalMarkdown')} has a verdict; its full text is the set you sign off. proposal.json sha256: ${input.proposalHash}`,
    options: [
      {
        option_key: SIGN_OFF,
        label: 'Take these rule changes',
        one_line_preview:
          'If you pick this, paqad writes the signed-off rules and tags their decisions.',
        trade_off: 'You give up: nothing beyond the rule changes listed in the proposal.',
        evidence: { file: runFilePath(runId, 'proposalMarkdown') },
      },
      {
        option_key: NOT_NOW,
        label: 'Keep the rules unchanged',
        one_line_preview: 'If you pick this, no rule file changes and the proposal waits for you.',
        trade_off: 'You give up: the new rules until you come back to the proposal.',
        evidence: {},
      },
    ],
    confidence: 0.5,
    requested_by: 'rules-discovery',
    task_session_id: signoffTaskId(runId),
    linked_requirements: [],
    created_at: created,
    status: 'pending',
    ttl_until: new Date(input.now.getTime() + ttlDays * 86_400_000).toISOString(),
    invalidation_watch: touchedRuleFiles(input.proposal),
  };
}

export function openSignoffDecision(
  projectRoot: string,
  proposal: Proposal,
  proposalHash: string,
  now: Date = new Date(),
): string {
  const store = new DecisionStore(projectRoot);
  const existing = store.findPendingDecisionForTask(signoffTaskId(proposal.run_id));
  if (existing !== null) {
    const pending = store.readPending(existing);
    if (pending !== null && signedHash(pending) === proposalHash) return existing;
    store.discard({ decisionId: existing, reason: 'the proposal changed before sign-off' });
  }
  const decisionId = store.nextDecisionId();
  store.writePending(buildSignoffPacket({ decisionId, proposal, proposalHash, now }));
  return decisionId;
}

export function signedHash(packet: DecisionPacket): string | null {
  return HASH_RE.exec(packet.context)?.[1] ?? null;
}

export type SignoffState =
  | { state: 'missing' }
  | { state: 'pending'; packet: DecisionPacket }
  | { state: 'not_now'; packet: DecisionPacket }
  | { state: 'signed'; packet: DecisionPacket; hash: string | null };

export function readSignoff(projectRoot: string, decisionId: string): SignoffState {
  const store = new DecisionStore(projectRoot);
  const resolved = store.readResolved(decisionId);
  if (resolved !== null) {
    const chosen = resolved.human_response?.chosen_option_key ?? null;
    return chosen === SIGN_OFF
      ? { state: 'signed', packet: resolved, hash: signedHash(resolved) }
      : { state: 'not_now', packet: resolved };
  }
  const pending = store.readPending(decisionId);
  return pending === null ? { state: 'missing' } : { state: 'pending', packet: pending };
}
