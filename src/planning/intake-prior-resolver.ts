import type { ActiveCapability } from '@/core/types/domain.js';

import { DecisionStore } from './decision-store.js';
import {
  computeDecisionFingerprint,
  type RepoStateSignatureInput,
} from './decision-fingerprint.js';
import type { DecisionCategory, DecisionOption } from './decision-packet.js';

export interface IntakePriorLookupInput {
  category: DecisionCategory;
  question: string;
  options: DecisionOption[];
  repoState: RepoStateSignatureInput;
}

export interface IntakePriorMatch {
  /** ID of the prior resolved decision that answered the same fingerprint. */
  priorDecisionId: string;
  /** The chosen option key from the prior. Pre-fill `human_response.chosen_option_key` with this. */
  chosenOptionKey: string;
  /** Free-text rationale for pre-filling — cites the prior decision ID. */
  rationale: string;
}

/**
 * Priors-first lookup for the ticket_intake decision elicitation sub-loop.
 *
 * Computes a fingerprint from (category, question, option_keys, repo_state)
 * and asks the DecisionStore whether a prior resolved decision answers the
 * same question. On a hit the caller pre-fills the new packet's
 * `human_response.chosen_option_key` with `chosenOptionKey` and uses the
 * returned `rationale` for `human_response.note`. The DecisionStore emits a
 * `decision-reused` audit event on every fingerprint hit — this function is
 * the first dedicated caller of that path for intake categories.
 *
 * Returns null when no prior matches; the caller must then ask the user.
 */
export function findIntakePriorMatch(
  projectRoot: string,
  input: IntakePriorLookupInput,
): IntakePriorMatch | null {
  const fingerprint = computeDecisionFingerprint({
    category: input.category,
    question: input.question,
    option_keys: input.options.map((option) => option.option_key),
    repo_state: input.repoState,
  });

  const store = new DecisionStore(projectRoot);
  const priorDecisionId = store.findReusableDecision({
    fingerprint,
    category: input.category,
    options: input.options,
  });

  if (priorDecisionId === null) {
    return null;
  }

  const prior = store.readResolved(priorDecisionId);
  const chosen = prior?.human_response?.chosen_option_key ?? null;
  if (chosen === null) {
    return null;
  }

  return {
    priorDecisionId,
    chosenOptionKey: chosen,
    rationale: `Auto-resolved from prior decision ${priorDecisionId}.`,
  };
}

export function buildRepoStateForIntake(
  active_capabilities: ActiveCapability[] | undefined,
  stack: string | null | undefined,
  packs: string[] | undefined,
): RepoStateSignatureInput {
  return {
    active_capabilities: active_capabilities ?? [],
    stack: stack ?? null,
    packs: packs ?? [],
  };
}
