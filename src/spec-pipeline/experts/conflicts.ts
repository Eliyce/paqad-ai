// Expert conflicts become decisions, never silent picks (issue #547, FR-6).
//
// When two experts make contradictory claims about the same target, the merge surfaces a conflict
// and the chief architect recommends one claim — but a recommendation is never applied. Each
// conflict becomes ONE `spec.expert_conflict` decision packet the human resolves, minted through
// the sanctioned writer (`createPendingDecision`), never hand-authored. An identical fork already
// answered in `.paqad/decisions/resolved/` is reused: its prior answer is applied and recorded,
// and nothing is minted (the FR-4.5 auto-answer pattern). Deterministic; zero model tokens.

import { createHash } from 'node:crypto';

import {
  createPendingDecision,
  readContractDecisions,
  type ContractDecisionOption,
} from '@/decisions/authoring.js';

import type { SynthesisAutoResolved, SynthesisConflict } from './synthesis.js';
import type { ExpertConflict, MergedExpertNotes } from './types.js';

const CATEGORY = 'spec.expert_conflict';

/** The outcome of turning the merge conflicts into decisions. */
export interface ConflictMintResult {
  /** Packets opened for conflicts with no prior answer. */
  minted: { id: string; target: string }[];
  /** Conflicts answered from an identical resolved fork — recorded, nothing minted (FR-6.3). */
  autoResolved: SynthesisAutoResolved[];
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** A stable identity for a fork: the target plus its claim SET (order-independent). */
function forkKey(target: string, claims: readonly string[]): string {
  const claimSet = [...new Set(claims.map(normalize))].sort();
  return `${normalize(target)}::${claimSet.join('|')}`;
}

/** The machine token embedded in a packet's context so a later run can recognise the same fork. */
export function forkToken(target: string, claims: readonly string[]): string {
  const hash = createHash('sha256').update(forkKey(target, claims)).digest('hex').slice(0, 16);
  return `[expert-conflict-fork:${hash}]`;
}

/** A deterministic, unique option key derived from a claim (stable across runs and order). */
function optionKeyFor(claim: string, used: Set<string>): string {
  const base =
    normalize(claim)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'claim';
  let key = base;
  let suffix = 2;
  while (used.has(key)) key = `${base}-${suffix++}`;
  used.add(key);
  return key;
}

/**
 * Mint one `spec.expert_conflict` packet per merge conflict, reusing a resolved fork when one
 * exists (FR-6.2 / FR-6.3). The chief's recommendation for a conflict pre-fills the packet's
 * recommendation. Returns the packets minted and the conflicts auto-resolved from priors.
 */
export function mintExpertConflictDecisions(
  projectRoot: string,
  merged: MergedExpertNotes,
  synthesisConflicts: readonly SynthesisConflict[],
): ConflictMintResult {
  const resolvedForks = collectResolvedForks(projectRoot);
  const recommendationByTarget = new Map(
    synthesisConflicts.map((conflict) => [normalize(conflict.target), conflict]),
  );
  const minted: ConflictMintResult['minted'] = [];
  const autoResolved: SynthesisAutoResolved[] = [];

  for (const conflict of merged.conflicts) {
    const token = forkToken(conflict.target, conflict.claims);
    const prior = resolvedForks.get(token);
    if (prior) {
      autoResolved.push({ target: conflict.target, chosen: prior.chosen, source: prior.id });
      continue;
    }
    const chief = recommendationByTarget.get(normalize(conflict.target));
    const { options, recommendation } = buildOptions(conflict, chief?.recommendation);
    const context = buildContext(conflict, chief?.rationale, token);
    const { id } = createPendingDecision(projectRoot, {
      category: CATEGORY,
      title: `Experts disagree on ${conflict.target}`,
      context,
      options,
      recommendation,
      origin: 'expert-conflict',
    });
    minted.push({ id, target: conflict.target });
  }

  return { minted, autoResolved };
}

interface ResolvedFork {
  id: string;
  /** The chosen claim label, mapped back from the resolved option key. */
  chosen: string;
}

/** Index resolved `spec.expert_conflict` packets by their fork token so a fork is matched once. */
function collectResolvedForks(projectRoot: string): Map<string, ResolvedFork> {
  const forks = new Map<string, ResolvedFork>();
  for (const { packet, status } of readContractDecisions(projectRoot)) {
    if (status !== 'resolved' || packet.category !== CATEGORY) continue;
    const resolved = packet as typeof packet & { chosen?: string };
    const match = /\[expert-conflict-fork:[0-9a-f]{16}\]/.exec(packet.context);
    if (!match || typeof resolved.chosen !== 'string') continue;
    const chosenOption = packet.options.find((option) => option.option_key === resolved.chosen);
    if (!chosenOption) continue;
    // First writer wins so the earliest resolution of a fork is the one reused.
    if (!forks.has(match[0])) forks.set(match[0], { id: packet.id, chosen: chosenOption.label });
  }
  return forks;
}

function buildOptions(
  conflict: ExpertConflict,
  recommendedClaim: string | undefined,
): { options: ContractDecisionOption[]; recommendation: string | null } {
  const used = new Set<string>();
  const options: ContractDecisionOption[] = [];
  let recommendation: string | null = null;
  conflict.claims.forEach((claim, index) => {
    const role = conflict.roles[index] ?? 'unknown';
    const key = optionKeyFor(claim, used);
    options.push({ option_key: key, label: `${claim} — ${role}` });
    if (recommendedClaim !== undefined && normalize(recommendedClaim) === normalize(claim)) {
      recommendation = key;
    }
  });
  return { options, recommendation };
}

function buildContext(
  conflict: ExpertConflict,
  rationale: string | undefined,
  token: string,
): string {
  const lines: string[] = [];
  if (rationale) lines.push(`Chief architect: ${rationale}`, '');
  lines.push(`Target: ${conflict.target}`);
  conflict.claims.forEach((claim, index) => {
    lines.push(`- ${conflict.roles[index] ?? 'unknown'}: ${claim}`);
  });
  lines.push('', token);
  return lines.join('\n');
}
