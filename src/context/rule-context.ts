/**
 * Deterministic trigger-load of full rule text (RAG buildout F5).
 *
 * Builds the rule slice of the session-context artifact: the always-resident
 * manifest (F4) plus the FULL text of only the rules that apply to the files in
 * play — the always-load rules (`**` / untriggered) and the scoped rules whose
 * declared `trigger_patterns` match the working-set paths. Non-matching scoped
 * rules are left out of the loaded text (their existence is still on the manifest
 * line). This replaces "load all ~50K of rule text every session" with a
 * deterministic, file-driven selection — never an embedding-RAG guess, because
 * omitting a rule that applies is a correctness failure.
 *
 * `refreshRuleContext` is the worker that recomposes the artifact under the F1
 * single-flight lock and atomic swap, so a reader never sees a half-written
 * artifact and concurrent refreshes never clobber each other.
 */
import { join } from 'node:path';

import { atomicWriteFile } from '@/background/atomic-artifact.js';
import { releaseLock, tryAcquireLock } from '@/background/single-flight-lock.js';
import { PATHS } from '@/core/constants/paths.js';
import type { CompiledRule, CompiledRulesStore } from '@/core/types/planning.js';
import { generateRuleManifest, scriptedSourcePaths } from '@/context/rule-manifest.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { isAlwaysLoadRule, ruleTriggersMatch } from '@/pipeline/rule-trigger-matcher.js';
import { readCompiledRules } from '@/planning/rule-compiler.js';
import { loadRuleScriptMap } from '@/rule-scripts/map.js';

/** A lock older than this (10 min) is treated as a crashed worker and reclaimed. */
const STALE_LOCK_MS = 10 * 60 * 1000;

/**
 * The product gate (issue #284): the resident rule footprint paqad adds to every
 * session — the manifest plus the always-load rule text, with NO files in play — must
 * stay under this byte budget. At ~4 bytes/token this is ≈4K tokens, the "paqad adds
 * at most N resident tokens" ceiling. It is a documented constant, deliberately NOT a
 * snapshot of any one project's live artifact: the committed budget test asserts a
 * representative rule fixture composes under it, and `paqad-ai doctor` reports each
 * project's actual footprint against its own full rule set. Trigger-loaded rule text
 * for the files in play rides on top and is bounded by the work, not by this budget.
 */
export const LEAN_RULE_CONTEXT_BUDGET_BYTES = 16_384;

/**
 * The fail-safe marker (issue #316) prepended to any written session-context artifact
 * that does NOT carry a real rule manifest with at least one rule. The framework
 * bootstrap tells the agent to treat this artifact as *the* rule contract and only
 * load the full `docs/instructions/rules/` tree when the file is MISSING. Without this
 * marker a drift/memory/retrieval-only artifact (compiled-rules store absent or empty)
 * looks like a valid "rules loaded" contract, so a bootstrap-obedient agent silently
 * loses every project rule. The marker makes that impossible: a rules-less artifact
 * always tells the reader to load the full rules tree before relying on rules.
 */
export const RULES_MISSING_FALLBACK_MARKER =
  '> ⚠️ No compiled rules in this artifact — load `docs/instructions/rules/` in full before relying on rules.';

export interface RuleSelection {
  /** Rules that apply to every change (`**` / untriggered). */
  alwaysLoad: CompiledRule[];
  /** Scoped rules whose triggers matched the working-set paths. */
  triggered: CompiledRule[];
}

/**
 * Split a rule set into the full-text rules to load for `changedPaths`. Always-
 * load rules are included regardless of `changedPaths`; scoped rules are included
 * only when a trigger matches. A rule is never in both lists.
 */
export function selectTriggeredRules(
  rules: readonly CompiledRule[],
  changedPaths: readonly string[],
): RuleSelection {
  const alwaysLoad: CompiledRule[] = [];
  const triggered: CompiledRule[] = [];
  for (const rule of rules) {
    if (isAlwaysLoadRule(rule)) {
      alwaysLoad.push(rule);
    } else if (changedPaths.length > 0 && ruleTriggersMatch(rule, changedPaths)) {
      triggered.push(rule);
    }
  }
  return { alwaysLoad, triggered };
}

function ruleTextBlock(rule: CompiledRule): string {
  const body = (rule.raw_text ?? rule.summary).trim();
  return `### ${rule.rule_id} · ${rule.title}\n${body}`;
}

export interface ComposeRuleContextOptions {
  changedPaths?: readonly string[];
  scriptedPaths?: ReadonlySet<string>;
}

/**
 * Compose the rule slice of the session-context: the manifest, then the full text
 * of the always-load and trigger-matched rules. When nothing is loaded beyond the
 * manifest (e.g. no files in play and no always-load rules), only the manifest is
 * emitted, keeping resident rule tokens minimal.
 */
export function composeRuleContext(
  store: CompiledRulesStore,
  options: ComposeRuleContextOptions = {},
): string {
  const changedPaths = options.changedPaths ?? [];
  const manifest = generateRuleManifest(store, { scriptedSourcePaths: options.scriptedPaths });
  const { alwaysLoad, triggered } = selectTriggeredRules(store.rules ?? [], changedPaths);

  const loaded = [...alwaysLoad, ...triggered];
  if (loaded.length === 0) {
    return manifest;
  }

  const heading =
    triggered.length > 0
      ? `## Loaded rule text — ${loaded.length} rules apply to the files in play`
      : `## Loaded rule text — ${loaded.length} always-on rules`;
  const blocks = loaded.map(ruleTextBlock).join('\n\n');
  return `${manifest}\n${heading}\n\n${blocks}\n`;
}

export interface WriteRuleContextOptions {
  /**
   * The composed codebase-memory slice (RAG buildout F21), appended after the rule
   * slice (durable facts sit with the rules, ahead of the ephemeral retrieval slices).
   * Empty/absent ⇒ omitted, so the artifact stays byte-identical to before F21.
   */
  memorySection?: string;
  /**
   * The composed retrieval slice (RAG buildout F11), appended after the rule slice
   * to form the single session-context artifact. Empty/absent ⇒ rule-only output,
   * byte-identical to the pre-F11 artifact (the disabled/cold-start == today path).
   */
  retrievalSection?: string;
  /**
   * The base-drift secondary context layer (RAG buildout F27), appended last as an
   * advisory heads-up. Empty/absent ⇒ omitted (the common no-drift case).
   */
  driftSection?: string;
  /**
   * Whether to compose the rule slice at all (issue #336). Defaults to `true` — the
   * artifact-first rule contract, unchanged for every existing caller. The prompt-time
   * worker passes `false` when the routed workflow is NOT feature-development: rules
   * (and rule-scripts) load only on the feature-development route, so a question /
   * pentest / docs / RCA / rules-analyze session composes memory + retrieval + drift
   * with NO rule manifest and NO #316 fallback marker (the rules are deliberately
   * absent, not accidentally missing). Feature-development keeps the full rule slice
   * and the fallback marker.
   */
  loadRules?: boolean;
}

/**
 * Compose the session-context artifact — the rule slice (manifest + trigger-loaded
 * full text) plus the optional retrieval slice — and atomic-write it. Returns the
 * artifact path, or `null` when there is nothing to write (no compiled rules AND no
 * retrieval section). This is the lock-free core: callers with no concurrency
 * (onboarding) use it directly; the background path uses {@link refreshRuleContext}
 * to serialise concurrent refreshes so a single artifact never has two writers.
 */
export async function writeRuleContext(
  projectRoot: string,
  options: WriteRuleContextOptions = {},
): Promise<string | null> {
  // #336 — rules load only on the feature-development route. When the worker passes
  // loadRules:false (any other routed workflow) the rule slice is not composed at all.
  const loadRules = options.loadRules ?? true;
  const store = loadRules ? await readCompiledRules(projectRoot) : null;
  const memorySection = options.memorySection?.trim() ?? '';
  const retrievalSection = options.retrievalSection?.trim() ?? '';
  const driftSection = options.driftSection?.trim() ?? '';
  if (!store && !memorySection && !retrievalSection && !driftSection) return null;

  let markdown = '';
  if (store) {
    const changedPaths = (await loadChangeEvidence(projectRoot)).files;
    const scriptedPaths = scriptedSourcePaths(loadRuleScriptMap(projectRoot));
    markdown = composeRuleContext(store, { changedPaths, scriptedPaths });
  }
  // Durable memory (F21) → ephemeral retrieval slices (F11) → base-drift heads-up (F27).
  for (const section of [memorySection, retrievalSection, driftSection]) {
    if (section) {
      markdown = markdown ? `${markdown}\n${section}\n` : `${section}\n`;
    }
  }

  // Fail-safe (issue #316): the bootstrap only loads the full rules tree when this
  // artifact is MISSING, so a written artifact without a real rule manifest would be
  // mistaken for a "rules loaded" contract and silently drop every project rule. When
  // no compiled rule made it in — the store is absent, or present but empty — prepend
  // the fallback marker so a bootstrap-obedient reader always knows to load the rules
  // in full. A populated store keeps its manifest and stays byte-identical to before.
  //
  // #336 refinement: the marker fires ONLY when rules were EXPECTED (loadRules) but
  // none made it in. On a non-feature-development route (loadRules:false) the rules
  // are deliberately absent — the reader must NOT be told to load them — so no marker.
  const hasRules = (store?.rules?.length ?? 0) > 0;
  if (loadRules && !hasRules) {
    markdown = `${RULES_MISSING_FALLBACK_MARKER}\n\n${markdown}`;
  }

  const target = join(projectRoot, PATHS.CONTEXT_SESSION_ARTIFACT);
  await atomicWriteFile(target, markdown);
  return target;
}

/**
 * Recompose the rule-context artifact under the F1 single-flight lock — the
 * worker the prompt-time trigger spawns. Returns the artifact path when written,
 * or `null` when there are no compiled rules or another refresh already holds the
 * lock. The lock dir is removed on completion; its parent `.paqad/locks` is shared
 * with other lock users, so it is intentionally left in place.
 */
export async function refreshRuleContext(
  projectRoot: string,
  options: WriteRuleContextOptions = {},
): Promise<string | null> {
  const lockDir = join(projectRoot, PATHS.LOCKS_DIR, 'rule-context.lock');
  const lock = tryAcquireLock(lockDir, { staleLockMs: STALE_LOCK_MS });
  if (!lock.acquired) {
    return null;
  }
  try {
    return await writeRuleContext(projectRoot, options);
  } finally {
    releaseLock(lockDir);
  }
}
