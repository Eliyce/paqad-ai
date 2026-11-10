import { readResolvedPackets } from '@/planning/decision-precedents.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';

import { readJsonFile } from './files.js';
import { absRunFile } from './paths.js';

export const RULES_PROPOSAL_CATEGORY = 'rules.proposal';

export interface UnjudgedDecision {
  id: string;
  category: string;
  title: string;
  chosen: string | null;
  chosen_label: string | null;
  rationale: string | null;
  change: string | null;
}

export interface DecisionIdea {
  idea_id: string;
  text: string;
  why: string;
  source_decisions: string[];
  scope: string;
}

export interface NotARule {
  id: string;
  reason: string;
}

export interface FromDecisions {
  ideas: DecisionIdea[];
  not_rules: NotARule[];
}

function field(packet: DecisionPacket, key: string): unknown {
  return (packet as unknown as Record<string, unknown>)[key];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function toUnjudged(packet: DecisionPacket): UnjudgedDecision {
  const chosen = text(field(packet, 'chosen')) ?? packet.human_response?.chosen_option_key ?? null;
  const option = packet.options.find((entry) => entry.option_key === chosen);
  return {
    id: packet.decision_id,
    category: packet.category,
    title: text(field(packet, 'title')) ?? packet.question,
    chosen,
    chosen_label: option?.label ?? null,
    rationale:
      text(field(packet, 'rationale')) ??
      text(packet.human_response?.note) ??
      text(packet.recommendation_reason),
    change: text(field(packet, 'change')) ?? text(packet.task_session_id),
  };
}

export function listUnjudgedDecisions(projectRoot: string): UnjudgedDecision[] {
  return readResolvedPackets(projectRoot)
    .filter((packet) => packet.status === 'resolved' || packet.status === 'delegated')
    .filter((packet) => packet.rules_discovery === undefined)
    .filter((packet) => packet.category !== RULES_PROPOSAL_CATEGORY)
    .map(toUnjudged)
    .sort((left, right) => left.id.localeCompare(right.id));
}

const SCOPE_RE = /^(project|module:[A-Za-z0-9._-]+|path:[^\s]+)$/;

export function validateFromDecisions(value: unknown, known: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  if (typeof value !== 'object' || value === null) return ['from-decisions.json is not an object'];
  const body = value as { ideas?: unknown; not_rules?: unknown };
  if (!Array.isArray(body.ideas)) problems.push('ideas must be a list');
  if (!Array.isArray(body.not_rules)) problems.push('not_rules must be a list');
  const seen = new Set<string>();
  for (const [index, raw] of (Array.isArray(body.ideas) ? body.ideas : []).entries()) {
    const idea = raw as Partial<DecisionIdea>;
    const where = `ideas[${index}]`;
    if (typeof idea.idea_id !== 'string' || idea.idea_id === '')
      problems.push(`${where} has no idea_id`);
    if (typeof idea.text !== 'string' || idea.text.trim() === '')
      problems.push(`${where} has no text`);
    if (typeof idea.scope !== 'string' || !SCOPE_RE.test(idea.scope)) {
      problems.push(`${where} scope must be project, module:<name> or path:<glob>`);
    }
    if (!Array.isArray(idea.source_decisions) || idea.source_decisions.length === 0) {
      problems.push(`${where} quotes no source decision`);
    } else {
      for (const id of idea.source_decisions) {
        if (!known.has(id)) problems.push(`${where} quotes ${String(id)}, which is not listed`);
        seen.add(id);
      }
    }
  }
  for (const [index, raw] of (Array.isArray(body.not_rules) ? body.not_rules : []).entries()) {
    const entry = raw as Partial<NotARule>;
    if (typeof entry.id !== 'string' || !known.has(entry.id)) {
      problems.push(`not_rules[${index}] names a decision that is not listed`);
    } else if (seen.has(entry.id)) {
      problems.push(`not_rules[${index}] ${entry.id} is also quoted by an idea`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      problems.push(`not_rules[${index}] has no reason`);
    }
  }
  return problems;
}

export function readFromDecisions(projectRoot: string, runId: string): FromDecisions {
  const read = readJsonFile<FromDecisions>(absRunFile(projectRoot, runId, 'fromDecisions'));
  if (read.state === 'missing') return { ideas: [], not_rules: [] };
  if (read.state === 'unreadable') {
    throw new Error(`from-decisions.json in run ${runId} is unreadable: ${read.error}`);
  }
  return {
    ideas: Array.isArray(read.value.ideas) ? read.value.ideas : [],
    not_rules: Array.isArray(read.value.not_rules) ? read.value.not_rules : [],
  };
}
