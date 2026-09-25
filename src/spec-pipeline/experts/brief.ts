// Per-expert briefs (issue #547, FR-3).
//
// After the roster decision, each needed expert gets ONE bounded brief — the request, the ticket
// acceptance criteria, the grounding reference POINTERS (never file bodies, FR-2.2 of #512), the
// clarity label and its signals, and the token budget the run granted it. The references are
// trimmed to fit that budget (4 characters per token) so an expert never receives more than its
// slice (INV-5). Deterministic; zero model tokens.
//
// Issue #581 (FR-8) — a brief is never written to a file. It is built in memory, its sha256 is
// recorded on the expert's roster entry in `experts.json` (`brief_hash`), and
// `paqad-ai spec pipeline experts brief <role>` prints it for the agent. Everything the brief is
// built from is recorded (`request.md`, the grounding references, the `clarification.json` label,
// the roster entry), so a rebuild gives the same text and the same hash (AC-8). The grounding
// terms are not persisted, so the brief no longer lists them.

import { sha256Hex } from '@/compliance/markdown.js';
import type { AgentRole } from '@/core/types/agent.js';

import type { ExpertRosterEntry } from '../run-store.js';
import type { GroundingArtifact, LabelArtifact } from '../types.js';
import { planExpertSlices } from './slice.js';
import type { ExpertNeed } from './types.js';

/** Characters per token used when trimming the grounding lists to a granted budget (FR-3.2). */
const CHARS_PER_TOKEN = 4;

/** The lens file the expert reads, shipped with the `expert-notes` skill. */
export function lensPathForRole(role: AgentRole): string {
  return `runtime/base/skills/expert-notes/references/lenses/${role}.md`;
}

/** One rendered brief, ready to hand to the `expert-notes` skill. */
export interface ExpertBrief {
  role: AgentRole;
  /** The token budget the ceiling actually granted this expert. */
  granted: number;
  /** Whether the ceiling shrank this expert's slice below its canonical budget. */
  clamped: boolean;
  /** Whether the grounding references were trimmed to fit the granted budget. */
  truncated: boolean;
  /** The rendered markdown brief. */
  content: string;
  /** The sha256 of `content`, recorded on the roster entry as `brief_hash`. */
  hash: string;
}

export interface BuildExpertBriefsInput {
  needs: readonly ExpertNeed[];
  request: string;
  ticketAcceptanceCriteria?: readonly string[];
  grounding: Pick<GroundingArtifact, 'references'>;
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
 * {@link planExpertSlices} (never re-derived), and each brief is rendered by
 * {@link renderExpertBrief} at the budget its slice was granted.
 */
export function buildExpertBriefs(input: BuildExpertBriefsInput): ExpertBriefsResult {
  const plan = planExpertSlices(
    input.needs.map((need) => need.role),
    input.ceiling,
  );
  const grantedByRole = new Map(plan.slices.map((slice) => [slice.role, slice]));
  const briefs: ExpertBrief[] = input.needs.map((need) => {
    const slice = grantedByRole.get(need.role)!;
    const rendered = renderExpertBrief({ ...input, need, granted: slice.granted });
    return { role: need.role, granted: slice.granted, clamped: slice.clamped, ...rendered };
  });
  return { briefs, warnings: plan.warnings };
}

/** The `experts.json` roster entry for one built brief (`tokens_used` is filled in by notes). */
export function rosterEntryFor(need: ExpertNeed, brief: ExpertBrief): ExpertRosterEntry {
  return {
    role: need.role,
    reason: need.reason,
    lens: lensPathForRole(need.role),
    budget_tokens: brief.granted,
    grounding_truncated: brief.truncated,
    brief_hash: brief.hash,
    tokens_used: null,
  };
}

export interface RenderExpertBriefInput {
  need: ExpertNeed;
  request: string;
  ticketAcceptanceCriteria?: readonly string[];
  grounding: Pick<GroundingArtifact, 'references'>;
  label: LabelArtifact;
  /** The token budget this expert was granted (the roster entry's `budget_tokens`). */
  granted: number;
}

/**
 * Render one expert's brief at an already-granted budget. The grounding references are trimmed
 * to `granted` at {@link CHARS_PER_TOKEN} characters per token, the longest first, so the most
 * numerous pointers survive. This is the one renderer: the `experts record` verb hashes its
 * output and the `experts brief` verb prints it, so both see the same text (AC-8).
 */
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

/**
 * Trim the grounding reference pointers to fit `granted * CHARS_PER_TOKEN` characters. When the
 * pool overflows, the longest pointers are dropped first (they cost the most budget), so the
 * largest number of pointers survives; `truncated` records whether anything fell.
 */
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

  return `${lines.join('\n')}\n`;
}
