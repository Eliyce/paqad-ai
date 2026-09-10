// Per-expert briefs (issue #547, FR-3).
//
// After the roster decision, each needed expert gets ONE bounded brief — the request, the ticket
// acceptance criteria, the grounding POINTERS (never file bodies, FR-2.2 of #512), the clarity
// label and its signals, and the token budget the run granted it. The grounding lists are trimmed
// to fit that budget (4 characters per token) so an expert never receives more than its slice
// (INV-5). Deterministic; zero model tokens. Briefs are scratch — the agent runs the `expert-notes`
// skill once per brief and never commits one.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { AgentRole } from '@/core/types/agent.js';

import { pipelineScratchDir } from '../orchestrator.js';
import type { GroundingArtifact, LabelArtifact } from '../types.js';
import { planExpertSlices } from './slice.js';
import type { ExpertNeed } from './types.js';

/** Characters per token used when trimming the grounding lists to a granted budget (FR-3.2). */
const CHARS_PER_TOKEN = 4;

/** The lens file the expert reads, shipped with the `expert-notes` skill. */
export function lensPathForRole(role: AgentRole): string {
  return `runtime/base/skills/expert-notes/references/lenses/${role}.md`;
}

/** Project-relative path to one expert's brief (scratch, never a bundle file). */
export function expertBriefPath(dirName: string, role: AgentRole): string {
  return join(pipelineScratchDir(dirName), 'briefs', `${role}.md`);
}

/** One rendered brief, ready to write and hand to the `expert-notes` skill. */
export interface ExpertBrief {
  role: AgentRole;
  /** The token budget the ceiling actually granted this expert. */
  granted: number;
  /** Whether the ceiling shrank this expert's slice below its canonical budget. */
  clamped: boolean;
  /** Whether the grounding lists were trimmed to fit the granted budget. */
  truncated: boolean;
  /** The rendered markdown brief. */
  content: string;
}

export interface BuildExpertBriefsInput {
  needs: readonly ExpertNeed[];
  request: string;
  ticketAcceptanceCriteria?: readonly string[];
  grounding: GroundingArtifact;
  label: LabelArtifact;
  ceiling: number;
}

export interface ExpertBriefsResult {
  briefs: ExpertBrief[];
  /** Slice-planning warnings (a ceiling breach), surfaced but never a dropped expert. */
  warnings: string[];
}

/**
 * Build one brief per needed expert (FR-3.1/FR-3.2). Slice sizes come from
 * {@link planExpertSlices} (never re-derived), and each expert's grounding pointers are trimmed to
 * its granted budget at {@link CHARS_PER_TOKEN} characters per token, removing the longest pointers
 * first so the most numerous pointers survive; the brief records whether it was trimmed.
 */
export function buildExpertBriefs(input: BuildExpertBriefsInput): ExpertBriefsResult {
  const plan = planExpertSlices(
    input.needs.map((need) => need.role),
    input.ceiling,
  );
  const grantedByRole = new Map(plan.slices.map((slice) => [slice.role, slice]));
  const briefs: ExpertBrief[] = input.needs.map((need) => {
    const slice = grantedByRole.get(need.role)!;
    const pointers = fitGroundingToBudget(input.grounding, slice.granted);
    return {
      role: need.role,
      granted: slice.granted,
      clamped: slice.clamped,
      truncated: pointers.truncated,
      content: renderBrief(need, input, pointers, slice.granted, pointers.truncated),
    };
  });
  return { briefs, warnings: plan.warnings };
}

/** Write the briefs to scratch and return their project-relative paths (FR-3.3). */
export function writeExpertBriefs(
  projectRoot: string,
  dirName: string,
  briefs: readonly ExpertBrief[],
): string[] {
  return briefs.map((brief) => {
    const rel = expertBriefPath(dirName, brief.role);
    const abs = join(projectRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, brief.content, 'utf8');
    return rel;
  });
}

interface FittedGrounding {
  terms: string[];
  references: string[];
  truncated: boolean;
}

/**
 * Trim the grounding term list and reference pointers to fit `granted * CHARS_PER_TOKEN`
 * characters. When the pool overflows, the longest pointers are dropped first (they cost the most
 * budget), so the largest number of pointers survives; `truncated` records whether anything fell.
 */
function fitGroundingToBudget(grounding: GroundingArtifact, granted: number): FittedGrounding {
  const items = [
    ...grounding.terms.map((text, index) => ({ kind: 'term' as const, text, index })),
    ...grounding.references.map((ref, index) => ({
      kind: 'ref' as const,
      text: `${ref.kind}: ${ref.ref}`,
      index: grounding.terms.length + index,
    })),
  ];
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
  const kept = items.filter((item) => !dropped.has(item.index));
  return {
    terms: kept.filter((item) => item.kind === 'term').map((item) => item.text),
    references: kept.filter((item) => item.kind === 'ref').map((item) => item.text),
    truncated: dropped.size > 0,
  };
}

function renderBrief(
  need: ExpertNeed,
  input: BuildExpertBriefsInput,
  pointers: FittedGrounding,
  granted: number,
  truncated: boolean,
): string {
  const lines: string[] = [];
  lines.push(`# Expert brief — ${need.role}`, '');
  lines.push(`- Lens: \`${lensPathForRole(need.role)}\``);
  lines.push(`- Why you were brought in: ${need.reason}`);
  lines.push(`- Granted budget: ${granted} tokens`);
  lines.push(`- Grounding truncated: ${truncated ? 'yes' : 'no'}`, '');

  lines.push('## Request', '', input.request.trim(), '');

  if (input.ticketAcceptanceCriteria && input.ticketAcceptanceCriteria.length > 0) {
    lines.push('## Ticket acceptance criteria', '');
    for (const criterion of input.ticketAcceptanceCriteria) {
      lines.push(`- ${criterion}`);
    }
    lines.push('');
  }

  lines.push('## Grounding (pointers, not bodies)', '');
  lines.push('Terms:');
  if (pointers.terms.length > 0) {
    for (const term of pointers.terms) lines.push(`- ${term}`);
  } else {
    lines.push('- (none)');
  }
  lines.push('', 'References:');
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

  return `${lines.join('\n')}\n`;
}
