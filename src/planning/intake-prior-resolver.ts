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
  priorDecisionId: string;
  chosenOptionKey: string;
  rationale: string;
}

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
