import type { DecisionCategory } from './decision-packet.js';

export interface BatchedAutoResolution {
  decision_id: string;
  category: DecisionCategory;
  question: string;
  chosen_option_key: string;
  rationale: string;
  chosen_label: string;
}

export interface BatchedConfirmAnswer {
  decision_id: string;
  outcome: 'accepted' | 'overridden';
  overridden_option_key?: string;
  note?: string;
}

export interface BatchedConfirmRequest {
  auto_resolutions: BatchedAutoResolution[];
  task_session_id: string;
  created_at: string;
}

export function isBatchedConfirmRequest(value: unknown): value is BatchedConfirmRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<BatchedConfirmRequest>;
  return (
    Array.isArray(candidate.auto_resolutions) &&
    candidate.auto_resolutions.every(
      (entry) =>
        typeof entry?.decision_id === 'string' &&
        typeof entry?.chosen_option_key === 'string' &&
        typeof entry?.rationale === 'string' &&
        typeof entry?.question === 'string' &&
        typeof entry?.chosen_label === 'string' &&
        typeof entry?.category === 'string',
    ) &&
    typeof candidate.task_session_id === 'string' &&
    typeof candidate.created_at === 'string'
  );
}

export function applyBatchedAnswer(
  resolution: BatchedAutoResolution,
  answer: BatchedConfirmAnswer,
): { chosen_option_key: string; intent: 'explicit' | 'safer-default' } {
  if (answer.outcome === 'accepted') {
    return { chosen_option_key: resolution.chosen_option_key, intent: 'safer-default' };
  }
  if (
    typeof answer.overridden_option_key !== 'string' ||
    answer.overridden_option_key.length === 0
  ) {
    throw new Error(
      `Batched confirm override for ${resolution.decision_id} must include overridden_option_key.`,
    );
  }
  return { chosen_option_key: answer.overridden_option_key, intent: 'explicit' };
}

export function renderBatchedRow(resolution: BatchedAutoResolution): string {
  return `${resolution.decision_id} — ${resolution.question} → ${resolution.chosen_label} (${resolution.rationale})`;
}
