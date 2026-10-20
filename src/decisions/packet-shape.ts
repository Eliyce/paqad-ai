import {
  DECISION_CATEGORIES,
  DECISION_CATEGORY_DEFAULTS,
  isDecisionPacket,
  type DecisionCategory,
  type DecisionHumanResponse,
  type DecisionOption,
  type DecisionPacket,
} from '@/planning/decision-packet.js';
import { computeDecisionFingerprint } from '@/planning/decision-fingerprint.js';

import type { ContractDecisionOption } from './authoring.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const REQUESTED_BY = 'paqad-decision-cli';

export interface ContractPacketFields {
  id: string;
  category: string;
  title: string;
  context: string;
  options: ContractDecisionOption[];
  recommendation: string | null;
  created_at: string;
  status: 'pending' | 'resolved';
  origin?: string;
  change?: string;
  chosen?: string;
  rationale?: string;
  resolved_at?: string;
}

export type RichPacketFields = Omit<
  DecisionPacket,
  'category' | 'context' | 'created_at' | 'recommendation'
> & { options: Array<DecisionOption & ContractDecisionOption> };

export function isDecisionCategory(value: unknown): value is DecisionCategory {
  return DECISION_CATEGORIES.includes(value as DecisionCategory);
}

export function richFieldsFor(packet: ContractPacketFields): RichPacketFields | null {
  if (!isDecisionCategory(packet.category)) return null;
  if (!Array.isArray(packet.options) || packet.options.length < 2 || packet.options.length > 5) {
    return null;
  }
  const createdMs = Date.parse(packet.created_at);
  const ttlDays = DECISION_CATEGORY_DEFAULTS[packet.category].ttl_days;
  const options = packet.options.map((option) => ({
    ...option,
    one_line_preview: option.label,
    trade_off: 'Not stated when the decision was opened.',
    evidence: option.evidence ?? {},
  }));
  const fields: RichPacketFields = {
    decision_id: packet.id,
    fingerprint: computeDecisionFingerprint({
      category: packet.category,
      question: packet.title,
      option_keys: packet.options.map((option) => option.option_key),
      repo_state: {},
    }),
    question: packet.title,
    options,
    ...(packet.recommendation
      ? { recommendation_reason: 'Recommended by the agent that opened this decision.' }
      : {}),
    confidence: 1,
    requested_by: packet.origin ? `paqad-${packet.origin}` : REQUESTED_BY,
    task_session_id: packet.change ?? 'no-active-change',
    status: packet.status,
    ttl_until: new Date((Number.isNaN(createdMs) ? 0 : createdMs) + ttlDays * DAY_MS).toISOString(),
    invalidation_watch: [],
  };
  if (packet.status === 'resolved' && typeof packet.chosen === 'string') {
    fields.human_response = humanResponseFor(packet.chosen, packet.rationale, packet.resolved_at);
  }
  return fields;
}

export function humanResponseFor(
  chosen: string,
  rationale: string | undefined,
  resolvedAt: string | undefined,
): DecisionHumanResponse {
  return {
    chosen_option_key: chosen,
    intent: 'explicit',
    explanation_rounds_used: 0,
    responded_at: resolvedAt ?? new Date(0).toISOString(),
    responded_by: 'human',
    carry_over_scope: 'task',
    ...(rationale ? { note: rationale } : {}),
  };
}

export function readAnyDecisionPacket(value: unknown): DecisionPacket | null {
  if (isDecisionPacket(value)) return value;
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<ContractPacketFields>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.title !== 'string' ||
    typeof candidate.context !== 'string' ||
    typeof candidate.created_at !== 'string' ||
    (candidate.status !== 'pending' && candidate.status !== 'resolved')
  ) {
    return null;
  }
  const rich = richFieldsFor(candidate as ContractPacketFields);
  if (rich === null) return null;
  const upgraded = {
    ...(candidate as ContractPacketFields),
    ...rich,
    recommendation: candidate.recommendation ?? null,
  };
  return isDecisionPacket(upgraded) ? upgraded : null;
}
