import { sha256Hex } from '@/compliance/markdown.js';
import type { AgentRole } from '@/core/types/agent.js';

import type { ExpertRosterEntry } from '../run-store.js';
import type { GroundingArtifact, LabelArtifact } from '../types.js';
import { planExpertSlices } from './slice.js';
import type { ExpertNeed } from './types.js';

const CHARS_PER_TOKEN = 4;

export function lensPathForRole(role: AgentRole): string {
  return `runtime/base/skills/expert-notes/references/lenses/${role}.md`;
}

export interface ExpertBrief {
  role: AgentRole;
  granted: number;
  clamped: boolean;
  truncated: boolean;
  content: string;
  hash: string;
}

export interface BuildExpertBriefsInput {
  needs: readonly ExpertNeed[];
  request: string;
  ticketAcceptanceCriteria?: readonly string[];
  grounding: Pick<GroundingArtifact, 'references'>;
  label: LabelArtifact;
  ceiling: number;
  projectVoice?: string;
}

export interface ExpertBriefsResult {
  briefs: ExpertBrief[];
  warnings: string[];
}

export function buildExpertBriefs(input: BuildExpertBriefsInput): ExpertBriefsResult {
  const plan = planExpertSlices(
    input.needs.map((need) => need.role),
    input.ceiling,
  );
  const grantedByRole = new Map(plan.slices.map((slice) => [slice.role, slice]));
  const briefs: ExpertBrief[] = input.needs.map((need) => {
    const slice = grantedByRole.get(need.role)!;
    const rendered = renderExpertBrief({
      ...input,
      need,
      granted: slice.granted,
      ...(input.projectVoice === undefined ? {} : { projectVoice: input.projectVoice }),
    });
    return { role: need.role, granted: slice.granted, clamped: slice.clamped, ...rendered };
  });
  return { briefs, warnings: plan.warnings };
}

export function rosterEntryFor(need: ExpertNeed, brief: ExpertBrief): ExpertRosterEntry {
  return {
    role: need.role,
    reason: need.reason,
    lens: lensPathForRole(need.role),
    budget_tokens: brief.granted,
    grounding_truncated: brief.truncated,
    brief_hash: brief.hash,
    tokens_used: null,
    ...(need.origin === undefined ? {} : { origin: need.origin }),
  };
}

export interface RenderExpertBriefInput {
  need: ExpertNeed;
  request: string;
  ticketAcceptanceCriteria?: readonly string[];
  grounding: Pick<GroundingArtifact, 'references'>;
  label: LabelArtifact;
  granted: number;
  projectVoice?: string;
}

export function renderExpertBrief(
  input: RenderExpertBriefInput,
): Pick<ExpertBrief, 'truncated' | 'content' | 'hash'> {
  const pointers = fitGroundingToBudget(input.grounding, input.granted);
  const content = renderBrief(input, pointers);
  return { truncated: pointers.truncated, content, hash: sha256Hex(content) };
}

interface FittedGrounding {
  references: string[];
  truncated: boolean;
}

function fitGroundingToBudget(
  grounding: Pick<GroundingArtifact, 'references'>,
  granted: number,
): FittedGrounding {
  const items = grounding.references.map((ref, index) => ({
    text: `${ref.kind}: ${ref.ref}`,
    index,
  }));
  const budgetChars = granted * CHARS_PER_TOKEN;
  const total = items.reduce((sum, item) => sum + item.text.length, 0);
  const dropped = new Set<number>();
  if (total > budgetChars) {
    let running = total;
    const byLength = [...items].sort((a, b) => b.text.length - a.text.length || a.index - b.index);
    for (const item of byLength) {
      if (running <= budgetChars) break;
      dropped.add(item.index);
      running -= item.text.length;
    }
  }
  return {
    references: items.filter((item) => !dropped.has(item.index)).map((item) => item.text),
    truncated: dropped.size > 0,
  };
}

function renderBrief(input: RenderExpertBriefInput, pointers: FittedGrounding): string {
  const { need } = input;
  const lines: string[] = [];
  lines.push(`# Expert brief — ${need.role}`, '');
  lines.push(`- Lens: \`${lensPathForRole(need.role)}\``);
  lines.push(`- Why you were brought in: ${need.reason}`);
  lines.push(`- Granted budget: ${input.granted} tokens`);
  lines.push(`- Grounding truncated: ${pointers.truncated ? 'yes' : 'no'}`, '');

  lines.push('## Request', '', input.request.trim(), '');

  if (input.ticketAcceptanceCriteria && input.ticketAcceptanceCriteria.length > 0) {
    lines.push('## Ticket acceptance criteria', '');
    for (const criterion of input.ticketAcceptanceCriteria) {
      lines.push(`- ${criterion}`);
    }
    lines.push('');
  }

  lines.push('## Grounding (pointers, not bodies)', '');
  lines.push('References:');
  if (pointers.references.length > 0) {
    for (const ref of pointers.references) lines.push(`- ${ref}`);
  } else {
    lines.push('- (none)');
  }
  lines.push('');

  lines.push('## Clarity', '', `- Label: ${input.label.label}`);
  if (input.label.signals.length > 0) {
    lines.push('- Signals:');
    for (const signal of input.label.signals) {
      lines.push(`  - ${signal.kind}: "${signal.span}"`);
    }
  }
  lines.push('');

  if (input.projectVoice !== undefined && input.projectVoice.length > 0) {
    lines.push(input.projectVoice, '');
  }

  return `${lines.join('\n')}\n`;
}
