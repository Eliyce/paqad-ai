import type { DecisionRecord } from '@/core/types/planning.js';

export const DECISION_CATEGORIES = [
  'component-reuse',
  'create-vs-reuse',
  'shared-abstraction',
  'ux-pattern',
  'architecture-path',
  'workflow-or-tool',
  'intake.requirement',
  'intake.confirm_auto_resolution',
  'intake.write_back',
  'delivery.open_pr',
  'delivery.ci_red',
  'spec.change',
  'spec.contradiction',
  'fix.proof_method',
  'test.flaky_judgement',
  'finding.triage',
  'quality.ratchet_exception',
] as const;

export const DECISION_STATUSES = [
  'pending',
  'resolved',
  'delegated',
  'expired',
  'superseded',
] as const;

export const DECISION_INTENTS = [
  'explicit',
  'delegated',
  'safer-default',
  'safer-default-by-cap',
  'created-new',
] as const;

export const DECISION_CARRY_OVER_SCOPES = ['session', 'task', 'none'] as const;

export type DecisionCategory = (typeof DECISION_CATEGORIES)[number];
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export type DecisionIntent = (typeof DECISION_INTENTS)[number];
export type DecisionCarryOverScope = (typeof DECISION_CARRY_OVER_SCOPES)[number];

export interface DecisionOptionEvidence {
  file?: string;
  last_modified?: string;
  callers?: number;
  similarity?: number;
  rule_match?: string;
  evidence_partial?: boolean;
}

export interface DecisionOption {
  option_key: string;
  label: string;
  one_line_preview: string;
  trade_off: string;
  evidence: DecisionOptionEvidence;
  technical_detail?: string;
}

export interface DecisionHumanResponse {
  chosen_option_key: string | null;
  intent: DecisionIntent;
  explanation_rounds_used: number;
  responded_at: string;
  responded_by: string;
  carry_over_scope: DecisionCarryOverScope;
  note?: string;
}

export interface DecisionPacket {
  decision_id: string;
  fingerprint: string;
  category: DecisionCategory;
  question: string;
  context: string;
  options: DecisionOption[];
  recommendation?: string | null;
  recommendation_reason?: string;
  confidence: number;
  requested_by: string;
  task_session_id: string;
  linked_requirements?: string[];
  linked_slice_id?: string;
  created_at: string;
  status: DecisionStatus;
  human_response?: DecisionHumanResponse;
  ttl_until: string;
  invalidation_watch: string[];
}

export type DecisionCategoryTtlOverrides = Partial<Record<DecisionCategory, number>>;

export const DECISION_CATEGORY_DEFAULTS: Record<
  DecisionCategory,
  { create_new: boolean; reversibility: DecisionRecord['reversibility']; ttl_days: number }
> = {
  'component-reuse': { create_new: true, reversibility: 'easy', ttl_days: 30 },
  'create-vs-reuse': { create_new: true, reversibility: 'easy', ttl_days: 30 },
  'shared-abstraction': { create_new: true, reversibility: 'moderate', ttl_days: 60 },
  'ux-pattern': { create_new: false, reversibility: 'easy', ttl_days: 30 },
  'architecture-path': { create_new: false, reversibility: 'hard', ttl_days: 90 },
  'workflow-or-tool': { create_new: false, reversibility: 'easy', ttl_days: 7 },
  // ticket_intake / delivery bookend categories — choices a refined ticket
  // implies and the open-PR gate. All reversible (the agent can re-ask).
  'intake.requirement': { create_new: true, reversibility: 'easy', ttl_days: 14 },
  'intake.confirm_auto_resolution': { create_new: false, reversibility: 'easy', ttl_days: 7 },
  'intake.write_back': { create_new: false, reversibility: 'easy', ttl_days: 1 },
  'delivery.open_pr': { create_new: false, reversibility: 'easy', ttl_days: 1 },
  // Delivery CI gate (issue #42). A red build where on_red needs a human call
  // (retry / override / abandon). Reversible: the agent re-asks on the next run.
  'delivery.ci_red': { create_new: false, reversibility: 'easy', ttl_days: 1 },
  // Spec lifecycle (issue #102). A mid-build goal change updates and re-freezes
  // the spec; a work-vs-spec contradiction is put to the human (fix code or
  // change spec) and is never resolved silently.
  'spec.change': { create_new: false, reversibility: 'moderate', ttl_days: 30 },
  'spec.contradiction': { create_new: false, reversibility: 'hard', ttl_days: 7 },
  // Fix protocol (issue #103). How to confirm an un-auto-checkable problem
  // (timing/appearance) is fixed — asked once, reused by kind. Reversible: the
  // agent can re-ask if the confirmation method stops fitting.
  'fix.proof_method': { create_new: false, reversibility: 'moderate', ttl_days: 30 },
  // Flaky-test trust (issue #106). A rare flip that could be a real intermittent
  // fault vs. flakiness — asked once, reused by kind. Reversible: the agent can
  // re-ask if the judgement stops fitting.
  'test.flaky_judgement': { create_new: false, reversibility: 'moderate', ttl_days: 30 },
  // Finding triage (issue #107). A genuinely ambiguous finding the rules-first
  // classifier could not sort into one of the four piles — asked once, reused by
  // kind. Reversible: the agent can re-ask if the verdict stops fitting.
  'finding.triage': { create_new: false, reversibility: 'moderate', ttl_days: 30 },
  // Quality-ratchet exception (issue #110). A legitimate need to worsen one of
  // the four quality measures — approved once, reused for the same kind by
  // `findReusableDecision`. Reversible: the agent can re-ask if the approval
  // stops fitting.
  'quality.ratchet_exception': { create_new: false, reversibility: 'moderate', ttl_days: 30 },
};

export function isDecisionPacket(value: unknown): value is DecisionPacket {
  return validateDecisionPacket(value).length === 0;
}

export function validateDecisionPacket(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) {
    return ['packet must be an object'];
  }

  const packet = value as Partial<DecisionPacket>;
  const errors: string[] = [];

  // Issue #184: ids are now `D-<ULID>`. Accept both the new ULID form and the
  // legacy numeric `D-{N}` form so pre-existing packets keep validating.
  if (!/^D-(?:\d+|[0-9A-HJKMNP-TV-Z]{26})$/.test(packet.decision_id ?? '')) {
    errors.push('decision_id must match D-{id}');
  }
  if (typeof packet.fingerprint !== 'string' || !packet.fingerprint.startsWith('sha256:')) {
    errors.push('fingerprint must be a sha256 string');
  }
  if (!DECISION_CATEGORIES.includes(packet.category as DecisionCategory)) {
    errors.push('category is invalid');
  }
  if (typeof packet.question !== 'string' || packet.question.trim().length === 0) {
    errors.push('question is required');
  }
  if (typeof packet.context !== 'string' || packet.context.trim().length === 0) {
    errors.push('context is required');
  }
  if (!Array.isArray(packet.options) || packet.options.length < 2 || packet.options.length > 5) {
    errors.push('options must contain 2 to 5 entries');
  } else {
    for (const [index, option] of packet.options.entries()) {
      errors.push(...validateDecisionOption(option, index));
    }
  }
  if (typeof packet.confidence !== 'number' || packet.confidence < 0 || packet.confidence > 1) {
    errors.push('confidence must be between 0 and 1');
  }
  if (typeof packet.requested_by !== 'string' || packet.requested_by.trim().length === 0) {
    errors.push('requested_by is required');
  }
  if (typeof packet.task_session_id !== 'string' || packet.task_session_id.trim().length === 0) {
    errors.push('task_session_id is required');
  }
  if (!isIsoDate(packet.created_at)) {
    errors.push('created_at must be an ISO date');
  }
  if (!DECISION_STATUSES.includes(packet.status as DecisionStatus)) {
    errors.push('status is invalid');
  }
  if (!isIsoDate(packet.ttl_until)) {
    errors.push('ttl_until must be an ISO date');
  }
  if (
    !Array.isArray(packet.invalidation_watch) ||
    packet.invalidation_watch.some((path) => typeof path !== 'string')
  ) {
    errors.push('invalidation_watch must be a string array');
  }
  if (packet.recommendation !== undefined && packet.recommendation !== null) {
    if (
      typeof packet.recommendation !== 'string' ||
      !packet.options?.some((option) => option.option_key === packet.recommendation)
    ) {
      errors.push('recommendation must reference an option_key');
    }
    if (
      packet.recommendation &&
      (typeof packet.recommendation_reason !== 'string' ||
        packet.recommendation_reason.trim().length === 0)
    ) {
      errors.push('recommendation_reason is required when recommendation is present');
    }
  }
  if (packet.human_response !== undefined) {
    /* v8 ignore next 1 -- human_response validation path not exercised in packet-builder unit tests */
    errors.push(...validateHumanResponse(packet.human_response, packet.options ?? []));
  }

  return errors;
}

export function toDecisionRecord(packet: DecisionPacket): DecisionRecord | null {
  if (
    packet.status === 'pending' ||
    !packet.human_response ||
    packet.human_response.chosen_option_key === null
  ) {
    return null;
  }

  const chosenOption = packet.options.find(
    (option) => option.option_key === packet.human_response?.chosen_option_key,
  );
  if (!chosenOption) {
    return null;
  }

  return {
    decision_id: packet.decision_id,
    choice: chosenOption.label,
    reason: packet.human_response.note?.trim() || chosenOption.trade_off,
    alternatives_rejected: packet.options
      .filter((option) => option.option_key !== chosenOption.option_key)
      .map((option) => ({
        alternative: option.label,
        rejection_reason: option.trade_off,
      })),
    /* v8 ignore next 1 -- linked_requirements is always set in practice; ?? [] is a safety net */
    linked_requirements: packet.linked_requirements ?? [],
    reversibility: DECISION_CATEGORY_DEFAULTS[packet.category].reversibility,
  };
}

function validateDecisionOption(value: unknown, index: number): string[] {
  if (typeof value !== 'object' || value === null) {
    return [`options[${index}] must be an object`];
  }

  const option = value as Partial<DecisionOption>;
  const errors: string[] = [];
  if (typeof option.option_key !== 'string' || option.option_key.trim().length === 0) {
    errors.push(`options[${index}].option_key is required`);
  }
  if (typeof option.label !== 'string' || option.label.trim().length === 0) {
    errors.push(`options[${index}].label is required`);
  }
  if (typeof option.one_line_preview !== 'string' || option.one_line_preview.trim().length === 0) {
    errors.push(`options[${index}].one_line_preview is required`);
  }
  if (typeof option.trade_off !== 'string' || option.trade_off.trim().length === 0) {
    errors.push(`options[${index}].trade_off is required`);
  }
  errors.push(...validateDecisionEvidence(option.evidence, index));
  if (option.technical_detail !== undefined && typeof option.technical_detail !== 'string') {
    errors.push(`options[${index}].technical_detail must be a string`);
  }
  return errors;
}

function validateDecisionEvidence(value: unknown, index: number): string[] {
  if (typeof value !== 'object' || value === null) {
    return [`options[${index}].evidence must be an object`];
  }

  const evidence = value as Partial<DecisionOptionEvidence>;
  const errors: string[] = [];
  if (evidence.file !== undefined && typeof evidence.file !== 'string') {
    errors.push(`options[${index}].evidence.file must be a string`);
  }
  if (evidence.last_modified !== undefined && !isIsoDate(evidence.last_modified)) {
    errors.push(`options[${index}].evidence.last_modified must be an ISO date`);
  }
  if (evidence.callers !== undefined && typeof evidence.callers !== 'number') {
    errors.push(`options[${index}].evidence.callers must be a number`);
  }
  if (
    evidence.similarity !== undefined &&
    (typeof evidence.similarity !== 'number' || evidence.similarity < 0 || evidence.similarity > 1)
  ) {
    errors.push(`options[${index}].evidence.similarity must be between 0 and 1`);
  }
  if (evidence.rule_match !== undefined && typeof evidence.rule_match !== 'string') {
    errors.push(`options[${index}].evidence.rule_match must be a string`);
  }
  if (evidence.evidence_partial !== undefined && typeof evidence.evidence_partial !== 'boolean') {
    errors.push(`options[${index}].evidence.evidence_partial must be a boolean`);
  }
  return errors;
}

function validateHumanResponse(value: unknown, options: DecisionOption[]): string[] {
  if (typeof value !== 'object' || value === null) {
    return ['human_response must be an object'];
  }

  const response = value as Partial<DecisionHumanResponse>;
  const errors: string[] = [];
  if (
    response.chosen_option_key !== null &&
    response.chosen_option_key !== undefined &&
    (typeof response.chosen_option_key !== 'string' ||
      !options.some((option) => option.option_key === response.chosen_option_key))
  ) {
    errors.push('human_response.chosen_option_key must reference an option_key');
  }
  if (!DECISION_INTENTS.includes(response.intent as DecisionIntent)) {
    errors.push('human_response.intent is invalid');
  }
  if (
    typeof response.explanation_rounds_used !== 'number' ||
    response.explanation_rounds_used < 0 ||
    response.explanation_rounds_used > 3
  ) {
    errors.push('human_response.explanation_rounds_used must be between 0 and 3');
  }
  if (!isIsoDate(response.responded_at)) {
    errors.push('human_response.responded_at must be an ISO date');
  }
  if (typeof response.responded_by !== 'string' || response.responded_by.trim().length === 0) {
    errors.push('human_response.responded_by is required');
  }
  if (!DECISION_CARRY_OVER_SCOPES.includes(response.carry_over_scope as DecisionCarryOverScope)) {
    errors.push('human_response.carry_over_scope is invalid');
  }
  if (response.note !== undefined && typeof response.note !== 'string') {
    errors.push('human_response.note must be a string');
  }
  return errors;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
