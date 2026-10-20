import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { appendModuleMapEvent } from '@/module-decisions/events.js';
import { canTransition, isExpired, type ModuleDecision } from '@/module-decisions/schema.js';
import { listDecisionsByState, readDecision, writeDecision } from '@/module-decisions/store.js';
import type { DecisionOption, DecisionPacket } from '@/planning/decision-packet.js';
import { DecisionStore } from '@/planning/decision-store.js';

export const DASHBOARD_ACTOR = 'dashboard';

export interface ApprovalsPauseItem {
  kind: 'pause';
  id: string;
  category: string;
  question: string;
  context: string;
  options: Pick<DecisionOption, 'option_key' | 'label' | 'one_line_preview' | 'trade_off'>[];
  recommendation: string | null;
  recommendation_reason: string | null;
  requested_by: string;
  created_at: string;
  ttl_until: string;
}

export interface ApprovalsProposalItem {
  kind: 'module-proposal';
  id: string;
  proposed_slug: string;
  proposed_name: string;
  reasoning: string;
  confidence: ModuleDecision['confidence'];
  prompt_excerpt: string;
  created_at: string;
  expires_at: string;
}

export interface ApprovalsFeed {
  generatedAt: string;
  pauses: ApprovalsPauseItem[];
  proposals: ApprovalsProposalItem[];
  pendingCount: number;
}

export class ApprovalNotFoundError extends Error {
  constructor(id: string) {
    super(`No pending approval found for ${id}.`);
    this.name = 'ApprovalNotFoundError';
  }
}

export class ApprovalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalConflictError';
  }
}

function pauseItem(packet: DecisionPacket): ApprovalsPauseItem {
  return {
    kind: 'pause',
    id: packet.decision_id,
    category: packet.category,
    question: packet.question,
    context: packet.context,
    options: packet.options.map((option) => ({
      option_key: option.option_key,
      label: option.label,
      one_line_preview: option.one_line_preview,
      trade_off: option.trade_off,
    })),
    recommendation: packet.recommendation ?? null,
    recommendation_reason: packet.recommendation_reason ?? null,
    requested_by: packet.requested_by,
    created_at: packet.created_at,
    ttl_until: packet.ttl_until,
  };
}

function proposalItem(decision: ModuleDecision): ApprovalsProposalItem {
  return {
    kind: 'module-proposal',
    id: decision.id,
    proposed_slug: decision.proposed_slug,
    proposed_name: decision.proposed_name,
    reasoning: decision.reasoning,
    confidence: decision.confidence,
    prompt_excerpt: decision.source_of_decision.prompt_excerpt,
    created_at: decision.created_at,
    expires_at: decision.expires_at,
  };
}

export function buildApprovalsFeed(projectRoot: string): ApprovalsFeed {
  const store = new DecisionStore(projectRoot);
  const pauses: ApprovalsPauseItem[] = [];
  for (const id of store.listPendingDecisionIds()) {
    const result = store.readPendingResult(id);
    if (result.packet) pauses.push(pauseItem(result.packet));
  }

  const now = new Date();
  const proposals = listDecisionsByState(projectRoot, 'proposed')
    .filter((decision) => !isExpired(decision, now))
    .map(proposalItem);

  const byNewest = (a: { created_at: string }, b: { created_at: string }): number =>
    b.created_at.localeCompare(a.created_at);
  pauses.sort(byNewest);
  proposals.sort(byNewest);

  return {
    generatedAt: now.toISOString(),
    pauses,
    proposals,
    pendingCount: pauses.length + proposals.length,
  };
}

export function appendDashboardAudit(
  projectRoot: string,
  action: string,
  fields: Record<string, string>,
): void {
  const path = join(projectRoot, PATHS.AUDIT_LOG);
  mkdirSync(dirname(path), { recursive: true });
  const pairs = Object.entries({ actor: DASHBOARD_ACTOR, ...fields })
    .map(([key, value]) => `${key}="${value.replace(/"/g, "'")}"`)
    .join(' ');
  appendFileSync(path, `[${new Date().toISOString()}] INFO ${action} ${pairs}\n`);
}

export interface ResolvePauseInput {
  decisionId: string;
  chosenOptionKey: string;
  note?: string;
}

export interface ResolvePauseResult {
  id: string;
  status: 'resolved';
  chosen_option_key: string;
}

export function resolvePauseDecision(
  projectRoot: string,
  input: ResolvePauseInput,
): ResolvePauseResult {
  const store = new DecisionStore(projectRoot);
  const result = store.readPendingResult(input.decisionId);
  if (!result.packet) {
    if (result.error) {
      throw new ApprovalConflictError(
        `Decision ${input.decisionId} cannot be resolved: ${result.error}`,
      );
    }
    throw new ApprovalNotFoundError(input.decisionId);
  }
  const packet = result.packet;
  const validKeys = packet.options.map((option) => option.option_key);
  if (!validKeys.includes(input.chosenOptionKey)) {
    throw new ApprovalConflictError(
      `Option '${input.chosenOptionKey}' is not one of ${input.decisionId}'s options (${validKeys.join(', ')}).`,
    );
  }

  store.resolve({
    decisionId: input.decisionId,
    humanResponse: {
      chosen_option_key: input.chosenOptionKey,
      intent: 'explicit',
      explanation_rounds_used: 0,
      responded_at: new Date().toISOString(),
      responded_by: DASHBOARD_ACTOR,
      carry_over_scope: 'session',
      ...(input.note ? { note: input.note } : {}),
    },
    respondedByProvider: DASHBOARD_ACTOR,
  });
  appendDashboardAudit(projectRoot, 'dashboard-decision-resolved', {
    decision_id: input.decisionId,
    chosen_option_key: input.chosenOptionKey,
  });
  return { id: input.decisionId, status: 'resolved', chosen_option_key: input.chosenOptionKey };
}

export interface ModuleProposalResult {
  id: string;
  state: 'accepted' | 'rejected';
  proposed_slug: string;
}

function transitionModuleProposal(
  projectRoot: string,
  id: string,
  target: 'accepted' | 'rejected',
): ModuleProposalResult {
  const decision = readDecision(projectRoot, id);
  if (decision === null) {
    throw new ApprovalNotFoundError(id);
  }
  if (!canTransition(decision.state, target)) {
    throw new ApprovalConflictError(
      `Module decision ${id} is '${decision.state}' and cannot become '${target}'.`,
    );
  }
  const now = new Date().toISOString();
  const updated: ModuleDecision = {
    ...decision,
    state: target,
    updated_at: now,
    approved_by: target === 'accepted' ? DASHBOARD_ACTOR : decision.approved_by,
  };
  writeDecision(projectRoot, updated);
  appendModuleMapEvent(projectRoot, {
    ts: now,
    type: target === 'accepted' ? 'module.declared' : 'module.decision.rejected',
    slug: decision.proposed_slug,
    via: id,
    approved_by: DASHBOARD_ACTOR,
  });
  appendDashboardAudit(projectRoot, `dashboard-module-proposal-${target}`, {
    decision_id: id,
    slug: decision.proposed_slug,
  });
  return { id, state: target, proposed_slug: decision.proposed_slug };
}

export function acceptModuleProposal(projectRoot: string, id: string): ModuleProposalResult {
  return transitionModuleProposal(projectRoot, id, 'accepted');
}

export function rejectModuleProposal(projectRoot: string, id: string): ModuleProposalResult {
  return transitionModuleProposal(projectRoot, id, 'rejected');
}
