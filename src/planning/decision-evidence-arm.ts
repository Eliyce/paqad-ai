import { statSync } from 'node:fs';
import { join } from 'node:path';

import { readCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import type { CodeKnowledgeIndex, CodeKnowledgeSymbol } from '@/code-knowledge/types.js';
import {
  createPendingDecision,
  readContractDecisions,
  type ContractDecisionOption,
} from '@/decisions/authoring.js';
import { recordDecisionReuse } from '@/decision-reuse/index.js';
import {
  buildDuplicationDecisionContext,
  findingKey,
  DUPLICATION_DECISION_CATEGORY,
} from '@/duplication/decisions.js';
import type { DuplicationFinding } from '@/duplication/types.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';

import { resolveDecisionArmConfig, type DecisionArmConfig } from './decision-arm-config.js';
import type { DecisionOptionEvidence } from './decision-packet.js';
import { symbolNameSimilarity } from './symbol-similarity.js';

export const RECOMMEND_REUSE_MIN_CALLERS = 3;

export const CREATE_NEW_OPTION_KEY = 'create-new';

export function reuseOptionKey(symbol: string): string {
  return `reuse:${symbol}`;
}

function forkToken(forkKey: string): string {
  return `[paqad-arm ${forkKey}]`;
}

function changeToken(changeKey: string): string {
  return `[paqad-arm-change ${changeKey}]`;
}

export function planForkKey(newName: string, existingSymbol: string): string {
  return `plan:${newName}~${existingSymbol}`;
}

export function duplicationForkKey(finding: DuplicationFinding): string {
  return `dup:${findingKey(finding)}`;
}

export interface ReuseForkEvidenceInput {
  projectRoot: string;
  file: string;
  callers: number;
  similarity: number;
}

export function buildReuseForkEvidence(input: ReuseForkEvidenceInput): DecisionOptionEvidence {
  const evidence: DecisionOptionEvidence = {
    file: input.file,
    callers: input.callers,
    similarity: Number(Math.min(1, Math.max(0, input.similarity)).toFixed(2)),
  };
  try {
    evidence.last_modified = statSync(join(input.projectRoot, input.file)).mtime.toISOString();
  } catch {
    evidence.evidence_partial = true;
  }
  return evidence;
}

export interface PlannedConstruct {
  name: string;
  justification?: string;
  module?: string | null;
}

export interface ReuseFork {
  forkKey: string;
  newName: string;
  justification: string;
  existing: CodeKnowledgeSymbol;
  similarity: number;
}

export function findPlanTimeReuseForks(input: {
  projectRoot: string;
  constructs: PlannedConstruct[];
  threshold: number;
  index?: CodeKnowledgeIndex | null;
}): ReuseFork[] {
  const index = input.index !== undefined ? input.index : readCodeKnowledgeIndex(input.projectRoot);
  if (!index || input.constructs.length === 0) {
    return [];
  }

  const forks: ReuseFork[] = [];
  for (const planned of input.constructs) {
    const best = closestSymbol(index.symbols, planned);
    if (best === null || best.similarity < input.threshold) {
      continue;
    }
    forks.push({
      forkKey: planForkKey(planned.name, best.symbol.name),
      newName: planned.name,
      justification: planned.justification ?? '',
      existing: best.symbol,
      similarity: best.similarity,
    });
  }
  return forks.sort((a, b) => b.similarity - a.similarity);
}

function closestSymbol(
  symbols: CodeKnowledgeSymbol[],
  planned: PlannedConstruct,
): { symbol: CodeKnowledgeSymbol; similarity: number } | null {
  let best: { symbol: CodeKnowledgeSymbol; similarity: number } | null = null;
  for (const symbol of symbols) {
    if (symbol.name === planned.name) {
      continue;
    }
    const similarity = symbolNameSimilarity(planned.name, symbol.name, {
      sameModule:
        planned.module !== undefined &&
        planned.module !== null &&
        planned.module === symbol.module_slug,
    });
    if (best === null || similarity > best.similarity) {
      best = { symbol, similarity };
    }
  }
  return best;
}

export interface ArmResult {
  minted: string[];
  warnings: string[];
  reusedDecisions: string[];
}

const EMPTY_RESULT: ArmResult = { minted: [], warnings: [], reusedDecisions: [] };

interface MintableFork {
  forkKey: string;
  title: string;
  context: string;
  options: ContractDecisionOption[];
  recommendation: string | null;
  score: number;
  warning: string;
}

export interface ArmInput {
  projectRoot: string;
  changeKey: string;
  config?: DecisionArmConfig;
  env?: NodeJS.ProcessEnv;
  sessionId?: string | null;
}

export function armDecisionFromPlan(
  input: ArmInput & { constructs: PlannedConstruct[] },
): ArmResult {
  return safely(() => {
    const config = input.config ?? resolveDecisionArmConfig(input.projectRoot, input.env);
    if (config.mode === 'off') {
      return EMPTY_RESULT;
    }
    const forks = findPlanTimeReuseForks({
      projectRoot: input.projectRoot,
      constructs: input.constructs,
      threshold: config.planThreshold,
    });
    return mintForks(
      input,
      config,
      forks.map((fork) => toMintable(input.projectRoot, fork)),
    );
  });
}

export function armDecisionFromDuplicationFinding(
  input: ArmInput & { finding: DuplicationFinding },
): ArmResult {
  return safely(() => {
    const config = input.config ?? resolveDecisionArmConfig(input.projectRoot, input.env);
    if (config.mode === 'off') {
      return EMPTY_RESULT;
    }
    return mintForks(input, config, [toMintableFinding(input.projectRoot, input.finding)]);
  });
}

function toMintable(projectRoot: string, fork: ReuseFork): MintableFork {
  const evidence = buildReuseForkEvidence({
    projectRoot,
    file: fork.existing.file,
    callers: fork.existing.caller_count,
    similarity: fork.similarity,
  });
  const percent = Math.round(fork.similarity * 100);
  return {
    forkKey: fork.forkKey,
    title: `Reuse ${fork.existing.name}, or build ${fork.newName}?`,
    context:
      `The plan introduces ${fork.newName}, which is ${percent}% similar to existing ` +
      `${fork.existing.name}.\n` +
      `- file: ${fork.existing.file}:${fork.existing.line}\n` +
      `- callers of the existing code: ${fork.existing.caller_count}\n` +
      `- the plan's justification: ${fork.justification || '(none given)'}`,
    options: [
      {
        option_key: reuseOptionKey(fork.existing.name),
        label: `Reuse ${fork.existing.name} (${fork.existing.file})`,
        evidence,
      },
      {
        option_key: CREATE_NEW_OPTION_KEY,
        label: `Build ${fork.newName} anyway — ${fork.justification || 'no justification given'}`,
      },
    ],
    recommendation:
      fork.existing.caller_count >= RECOMMEND_REUSE_MIN_CALLERS
        ? reuseOptionKey(fork.existing.name)
        : null,
    score: fork.similarity,
    warning:
      `${fork.newName} is ${percent}% similar to existing ${fork.existing.name} ` +
      `(${fork.existing.file}, ${fork.existing.caller_count} callers) — reuse it, or say why not`,
  };
}

function toMintableFinding(projectRoot: string, finding: DuplicationFinding): MintableFork {
  const matchedName = finding.matched_symbol ?? finding.matched_file;
  const evidence = buildReuseForkEvidence({
    projectRoot,
    file: finding.matched_file,
    callers: finding.matched_callers,
    similarity: finding.similarity,
  });
  return {
    forkKey: duplicationForkKey(finding),
    title: `Reuse ${matchedName}, or keep the new copy in ${finding.file}?`,
    context: buildDuplicationDecisionContext(finding),
    options: [
      {
        option_key: reuseOptionKey(matchedName),
        label: `Reuse ${matchedName} (${finding.matched_file})`,
        evidence,
      },
      {
        option_key: CREATE_NEW_OPTION_KEY,
        label: `Keep the new copy in ${finding.file}`,
      },
    ],
    recommendation:
      finding.matched_callers >= RECOMMEND_REUSE_MIN_CALLERS ? reuseOptionKey(matchedName) : null,
    score: finding.similarity,
    warning: finding.message,
  };
}

function mintForks(input: ArmInput, config: DecisionArmConfig, forks: MintableFork[]): ArmResult {
  if (forks.length === 0) {
    return EMPTY_RESULT;
  }
  const stored = readContractDecisions(input.projectRoot);
  const result: ArmResult = { minted: [], warnings: [], reusedDecisions: [] };

  let openedForChange = stored.filter((row) =>
    row.packet.context.includes(changeToken(input.changeKey)),
  ).length;

  const ranked = [...forks].sort((a, b) => b.score - a.score);
  for (const fork of ranked) {
    const token = forkToken(fork.forkKey);
    const prior = stored.find((row) => row.packet.context.includes(token));

    if (prior !== undefined) {
      if (prior.status === 'resolved') {
        recordDecisionReuse(
          input.projectRoot,
          {
            decisionId: prior.packet.id,
            category: prior.packet.category,
            matchKind: 'exact',
            note: `evidence-armed fork ${fork.forkKey}`,
          },
          { sessionId: input.sessionId ?? null },
        );
        result.reusedDecisions.push(`reused_decision:${prior.packet.id}`);
      }
      continue;
    }

    if (config.mode !== 'strict' || openedForChange >= config.maxPerChange) {
      result.warnings.push(fork.warning);
      continue;
    }

    const created = createPendingDecision(input.projectRoot, {
      category: DUPLICATION_DECISION_CATEGORY,
      title: fork.title,
      context: `${fork.context}\n${token}\n${changeToken(input.changeKey)}`,
      options: fork.options,
      recommendation: fork.recommendation,
      origin: 'evidence-armed',
      change: featureChangeKey(input.changeKey),
    });
    result.minted.push(created.id);
    openedForChange += 1;
  }

  return result;
}

function safely(run: () => ArmResult): ArmResult {
  try {
    return run();
  } catch {
    return EMPTY_RESULT;
  }
}
