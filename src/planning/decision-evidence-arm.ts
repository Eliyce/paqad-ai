// Evidence-armed create-vs-reuse pauses (issue #361).
//
// The Decision Pause has always had teeth — a pending `D-*.json` blocks a mutating edit — but
// the create-vs-reuse fork only ever fired when the model VOLUNTEERED that it was at one. In
// practice the fork gets resolved silently, usually toward "build new". This module makes the
// pause fire from evidence instead of honesty: two deterministic triggers detect a strong reuse
// fork, fill the proof (file, last change, callers, similarity) from artifacts paqad already
// builds, and mint the packet themselves.
//
//   plan-time   — at `plan compile`, each declared `reuse.new_constructs[]` entry is scored
//                 against the code-knowledge index (#353). A score at or above the threshold is
//                 a fork worth asking about.
//   change-time — a blocking-band duplication finding (#358) is already the same question with
//                 the evidence attached; #358 built the context, this mints the packet.
//
// Both go through `createPendingDecision` — the only sanctioned writer — and both fill their
// evidence through ONE builder, so the two paths can never disagree about what proof means.
//
// Every guard here exists because a false pause blocks real work:
//   - `decision_arm_mode` ships `warn`: the fork is computed and reported, nothing is minted.
//     Only `strict` opens a pause. `off` reproduces pre-#361 behaviour exactly.
//   - `decision_arm_max_per_change` caps minting (default 1) — a change is asked about its
//     strongest fork and never interrogated repeatedly. Capped-out forks are REPORTED, never
//     silently dropped.
//   - The same fork never mints twice: identity rides in the packet context as a machine token.
//   - Priors first: a fork already answered in an earlier change auto-applies that answer and
//     records a decision-reuse row instead of asking again.
//   - No index ⇒ no scoring and no packet. A packet without evidence would be worse than none.

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

import { resolveDecisionArmConfig, type DecisionArmConfig } from './decision-arm-config.js';
import type { DecisionOptionEvidence } from './decision-packet.js';
import { symbolNameSimilarity } from './symbol-similarity.js';

/** Callers at or above this make reuse the recommended option (issue #361). */
export const RECOMMEND_REUSE_MIN_CALLERS = 3;

/** The option key for building the new thing anyway. */
export const CREATE_NEW_OPTION_KEY = 'create-new';

/** The option key prefix for reusing a named existing symbol. */
export function reuseOptionKey(symbol: string): string {
  return `reuse:${symbol}`;
}

// ── Machine tokens ──────────────────────────────────────────────────────────
// Packet identity rides in the context as tokens rather than in new storage, the same trick
// #358 uses to correlate a resolved packet back to its finding. Two tokens, because the two
// questions are different: "have I already asked THIS fork (ever)?" and "how many pauses has
// THIS change opened?".

/** Stable, change-independent identity of a fork — the priors + duplicate-suppression key. */
function forkToken(forkKey: string): string {
  return `[paqad-arm ${forkKey}]`;
}

/** The change a packet was minted for — the per-change cap key. */
function changeToken(changeKey: string): string {
  return `[paqad-arm-change ${changeKey}]`;
}

/** The fork key for a planned new construct that near-duplicates an existing symbol. */
export function planForkKey(newName: string, existingSymbol: string): string {
  return `plan:${newName}~${existingSymbol}`;
}

/** The fork key for a duplication finding, reusing #358's stable finding identity. */
export function duplicationForkKey(finding: DuplicationFinding): string {
  return `dup:${findingKey(finding)}`;
}

// ── The shared evidence builder ─────────────────────────────────────────────

export interface ReuseForkEvidenceInput {
  projectRoot: string;
  /** Project-relative path of the existing code the fork is about. */
  file: string;
  /** Distinct call sites of the existing code, from the index (0 when unknown). */
  callers: number;
  /** How close the new thing is to the existing one, in `[0, 1]`. */
  similarity: number;
}

/**
 * Build the evidence block behind a reuse option: which file holds the existing code, when it
 * last changed, how many callers depend on it, and how similar the new thing is. The ONE
 * builder both triggers use, so plan-time and change-time evidence always mean the same thing.
 *
 * `last_modified` comes from the file's mtime and is simply omitted when the file cannot be
 * stat'd — a missing timestamp is marked `evidence_partial` rather than guessed, because a
 * fabricated date is worse than an absent one.
 */
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

// ── Plan-time fork detection ────────────────────────────────────────────────

/** A new construct as the detector needs to see it. */
export interface PlannedConstruct {
  name: string;
  justification?: string;
  /** Module the new construct belongs to, when the plan scopes it. */
  module?: string | null;
}

/** One detected fork: a planned new construct that near-duplicates an existing symbol. */
export interface ReuseFork {
  forkKey: string;
  newName: string;
  justification: string;
  existing: CodeKnowledgeSymbol;
  similarity: number;
}

/**
 * Score every planned new construct against the index and return the qualifying forks,
 * strongest first. Returns `[]` when the index is absent — an unbuilt index means there is
 * nothing to compare against, not that everything is new (AC-4).
 */
export function findPlanTimeReuseForks(input: {
  projectRoot: string;
  constructs: PlannedConstruct[];
  threshold: number;
  /** Injectable for tests; defaults to the project's stored index. */
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

/** The highest-scoring existing symbol for a planned construct, or null when none scores. */
function closestSymbol(
  symbols: CodeKnowledgeSymbol[],
  planned: PlannedConstruct,
): { symbol: CodeKnowledgeSymbol; similarity: number } | null {
  let best: { symbol: CodeKnowledgeSymbol; similarity: number } | null = null;
  for (const symbol of symbols) {
    // A construct that already exists under the same name is not a fork — it is either a
    // rename of the same thing or an edit to it, and neither is a reuse-or-create question.
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

// ── Minting ─────────────────────────────────────────────────────────────────

/** What one arming run concluded. */
export interface ArmResult {
  /** Ids of the packets minted this run (at most `maxPerChange`). */
  minted: string[];
  /** Forks that qualified but were not asked about, worded for the developer. */
  warnings: string[];
  /** `reused_decision:<id>` for every fork an earlier answer covered (AC-2). */
  reusedDecisions: string[];
}

const EMPTY_RESULT: ArmResult = { minted: [], warnings: [], reusedDecisions: [] };

/** A fork reduced to what minting needs, so both triggers share one mint path. */
interface MintableFork {
  forkKey: string;
  title: string;
  context: string;
  options: ContractDecisionOption[];
  recommendation: string | null;
  /** Ranking key — the strongest fork is the one a capped change gets asked about. */
  score: number;
  /** The developer-facing line used when the cap suppresses this fork. */
  warning: string;
}

export interface ArmInput {
  projectRoot: string;
  /** Identity of the change being armed (the feature bundle dir name). */
  changeKey: string;
  config?: DecisionArmConfig;
  env?: NodeJS.ProcessEnv;
  sessionId?: string | null;
}

/**
 * Arm from a plan's declared new constructs. Called by `plan compile`; never throws into it.
 */
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

/**
 * Arm from a blocking-band duplication finding (#358). The finding already carries the matched
 * file, its similarity, and its caller count, so the same evidence builder fills the option.
 */
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

/** The plan-time fork rendered into the packet content. */
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

/** The change-time finding rendered into the packet content. */
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
    // #358 already owns this context's wording and its correlation token; reusing its builder
    // keeps `applyResolvedDecisions` able to match the packet back to the finding.
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

/**
 * The one mint path: drop forks already asked or already answered, honour the per-change cap,
 * and report everything that did not get minted rather than dropping it silently.
 */
function mintForks(input: ArmInput, config: DecisionArmConfig, forks: MintableFork[]): ArmResult {
  if (forks.length === 0) {
    return EMPTY_RESULT;
  }
  const stored = readContractDecisions(input.projectRoot);
  const result: ArmResult = { minted: [], warnings: [], reusedDecisions: [] };

  // Already opened for this change — every packet carrying this change's token counts against
  // the cap, so a re-run of `plan compile` cannot walk the change past its budget.
  let openedForChange = stored.filter((row) =>
    row.packet.context.includes(changeToken(input.changeKey)),
  ).length;

  const ranked = [...forks].sort((a, b) => b.score - a.score);
  for (const fork of ranked) {
    const token = forkToken(fork.forkKey);
    const prior = stored.find((row) => row.packet.context.includes(token));

    if (prior !== undefined) {
      if (prior.status === 'resolved') {
        // AC-2 — this exact fork was answered before. Apply that answer instead of asking.
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
      // Pending or resolved, the question is not asked twice.
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
    });
    result.minted.push(created.id);
    openedForChange += 1;
  }

  return result;
}

/**
 * Run an arming pass, degrading any failure to "nothing armed" (INV-4). Arming is a bonus on
 * top of `plan compile` and the duplication scan; it must never be the reason either fails.
 */
function safely(run: () => ArmResult): ArmResult {
  try {
    return run();
  } catch {
    return EMPTY_RESULT;
  }
}
