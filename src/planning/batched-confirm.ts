/**
 * Data shape and helpers for the batched-confirm Decision Pause primitive
 * introduced for ticket_intake (category `intake.confirm_auto_resolution`).
 *
 * Single-packet flow remains the default. The batched primitive is used
 * exclusively when the intake stage has auto-resolved N decisions from
 * priors / rules and needs the user to accept-all or override per row.
 */

import type { DecisionCategory } from './decision-packet.js';

export interface BatchedAutoResolution {
  /** The pending decision the agent auto-resolved. */
  decision_id: string;
  category: DecisionCategory;
  question: string;
  /** The option_key the agent pre-filled from a prior, rule, or the ticket. */
  chosen_option_key: string;
  /** Free-text justification (cites the source, e.g. "from prior D-12"). */
  rationale: string;
  /** A short label for the chosen option, for display purposes. */
  chosen_label: string;
}

export interface BatchedConfirmAnswer {
  decision_id: string;
  /** Either accept the agent's pick or replace it with another option_key. */
  outcome: 'accepted' | 'overridden';
  /** Set when outcome === 'overridden'. */
  overridden_option_key?: string;
  /** Optional free-text note from the user. */
  note?: string;
}

export interface BatchedConfirmRequest {
  /** Pre-resolved auto-decisions to present together. */
  auto_resolutions: BatchedAutoResolution[];
  /** Where the request was raised (for audit + ticket linkage). */
  task_session_id: string;
  /** ISO timestamp the batch was assembled. */
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

/**
 * Apply a batched-confirm answer to a single auto-resolution. Returns the
 * effective chosen option_key for that decision after the user's input.
 */
export function applyBatchedAnswer(
  resolution: BatchedAutoResolution,
  answer: BatchedConfirmAnswer,
): { chosen_option_key: string; intent: 'explicit' | 'safer-default' } {
  if (answer.outcome === 'accepted') {
    return { chosen_option_key: resolution.chosen_option_key, intent: 'safer-default' };
  }
  if (typeof answer.overridden_option_key !== 'string' || answer.overridden_option_key.length === 0) {
    throw new Error(
      `Batched confirm override for ${resolution.decision_id} must include overridden_option_key.`,
    );
  }
  return { chosen_option_key: answer.overridden_option_key, intent: 'explicit' };
}

/**
 * Build the user-facing summary line for one batched row. Kept here so the
 * CLI UI, the entry-file docs, and any host-side renderer agree on phrasing.
 */
export function renderBatchedRow(resolution: BatchedAutoResolution): string {
  return `${resolution.decision_id} — ${resolution.question} → ${resolution.chosen_label} (${resolution.rationale})`;
}
