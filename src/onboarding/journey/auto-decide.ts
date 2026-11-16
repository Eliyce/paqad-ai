import { suggestEarlierAnswer } from '@/decisions/earlier-answers.js';
import { DecisionStore } from '@/planning/decision-store.js';

import { AUTO_RESPONDER, appendChoice } from './choices.js';
import { JourneyRefusal } from './errors.js';
import { currentStage } from './fold.js';
import { openedByJourney } from './packets.js';
import { requireRun } from './run-store.js';
import type { ChoiceRow } from './types.js';

export const AUTO_REASON = 'onboarding journey says auto-recommended';

export interface AutoDecision {
  decision_id: string;
  chosen_option_key: string;
  choice: ChoiceRow;
}

export function autoDecide(projectRoot: string, decisionId: string, now: () => Date): AutoDecision {
  const run = requireRun(projectRoot);
  if (run.status !== 'running') {
    throw new JourneyRefusal(`The journey is ${run.status}; resume it before answering decisions.`);
  }
  const store = new DecisionStore(projectRoot);
  const packet = store.readPending(decisionId);
  if (!packet) throw new JourneyRefusal(`Pending decision ${decisionId} not found.`);
  if (packet.created_at < run.created_at) {
    throw new JourneyRefusal(
      `Decision ${decisionId} was opened before this journey; a person answers it.`,
    );
  }
  if (!openedByJourney(projectRoot, run, decisionId)) {
    throw new JourneyRefusal(
      `Decision ${decisionId} was not opened by this onboarding journey; a person answers it.`,
    );
  }
  const chosen = packet.recommendation ?? null;
  if (!chosen || !packet.options.some((option) => option.option_key === chosen)) {
    throw new JourneyRefusal(
      `Decision ${decisionId} has no recommended option; fail the step so a person can answer it.`,
    );
  }
  if (packet.earlier_check?.status === 'required') {
    suggestEarlierAnswer(projectRoot, decisionId, { none: true, reason: AUTO_REASON });
  }
  const at = now().toISOString();
  store.resolve({
    decisionId,
    humanResponse: {
      chosen_option_key: chosen,
      intent: 'delegated',
      explanation_rounds_used: 0,
      responded_at: at,
      responded_by: AUTO_RESPONDER,
      carry_over_scope: 'none',
      note: AUTO_REASON,
    },
  });
  const choice = appendChoice(projectRoot, {
    ts: at,
    run_id: run.run_id,
    stage: currentStage(run) ?? 'finish',
    kind: 'decision',
    choice: chosen,
    reason: packet.recommendation_reason ?? AUTO_REASON,
    by: AUTO_RESPONDER,
    decision_id: decisionId,
    details: { question: packet.question },
  });
  return { decision_id: decisionId, chosen_option_key: chosen, choice };
}
