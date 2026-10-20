import { createHash } from 'node:crypto';

import {
  createPendingDecision,
  readContractDecisions,
  type ContractDecisionOption,
} from '@/decisions/authoring.js';

import type { SynthesisAutoResolved, SynthesisConflict } from './synthesis.js';
import type { ExpertConflict, MergedExpertNotes } from './types.js';

const CATEGORY = 'spec.expert_conflict';

export interface ConflictMintResult {
  minted: { id: string; target: string }[];
  autoResolved: SynthesisAutoResolved[];
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function forkKey(target: string, claims: readonly string[]): string {
  const claimSet = [...new Set(claims.map(normalize))].sort();
  return `${normalize(target)}::${claimSet.join('|')}`;
}

export function forkToken(target: string, claims: readonly string[]): string {
  const hash = createHash('sha256').update(forkKey(target, claims)).digest('hex').slice(0, 16);
  return `[expert-conflict-fork:${hash}]`;
}

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
  chosen: string;
}

function collectResolvedForks(projectRoot: string): Map<string, ResolvedFork> {
  const forks = new Map<string, ResolvedFork>();
  for (const { packet, status } of readContractDecisions(projectRoot)) {
    if (status !== 'resolved' || packet.category !== CATEGORY) continue;
    const resolved = packet as typeof packet & { chosen?: string };
    const match = /\[expert-conflict-fork:[0-9a-f]{16}\]/.exec(packet.context);
    if (!match || typeof resolved.chosen !== 'string') continue;
    const chosenOption = packet.options.find((option) => option.option_key === resolved.chosen);
    if (!chosenOption) continue;
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
