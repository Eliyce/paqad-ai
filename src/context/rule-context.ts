import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFile } from '@/background/atomic-artifact.js';
import { releaseLock, tryAcquireLock } from '@/background/single-flight-lock.js';
import { PATHS } from '@/core/constants/paths.js';
import type { CompiledRule, CompiledRulesStore } from '@/core/types/planning.js';
import { generateRuleManifest, scriptedSourcePaths } from '@/context/rule-manifest.js';
import { readChangeStartPoint } from '@/feature-evidence/delivery.js';
import { isPaqadArtifactPath, loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { subtractUnchangedBaselineFiles } from '@/pipeline/dirty-baseline.js';
import { isAlwaysLoadRule, ruleTriggersMatch } from '@/pipeline/rule-trigger-matcher.js';
import {
  compileRules,
  isCompiledRulesStale,
  readCompiledRules,
  writeCompiledRules,
} from '@/planning/rule-compiler.js';
import { loadRuleScriptMap } from '@/rule-scripts/map.js';

const STALE_LOCK_MS = 10 * 60 * 1000;

export const LEAN_RULE_CONTEXT_BUDGET_BYTES = 16_384;

export const RULES_MISSING_FALLBACK_MARKER =
  '> ⚠️ No compiled rules in this artifact — load `docs/instructions/rules/` in full before relying on rules.';

export const DECISION_PAUSE_REMINDER =
  '## Decision pause is active\n' +
  '> Before a create-vs-reuse, shared-abstraction, architecture-path, component-reuse, ' +
  'workflow-or-tool, or ux-pattern choice, write a decision packet and pause for the human ' +
  '(`paqad-ai decision create …`) — do not decide it unilaterally.';

export interface RuleSelection {
  alwaysLoad: CompiledRule[];
  triggered: CompiledRule[];
}

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

export function composeLoadedRuleText(rules: readonly CompiledRule[]): string {
  return rules.map(ruleTextBlock).join('\n\n');
}

export interface RuleApplicability {
  rule_id: string;
  title: string;
  always_load: boolean;
  matched_paths: string[];
}

export interface ChangeRuleApplicability {
  applicable: RuleApplicability[];
  loadedRuleText: string;
  ruleTextHash: string;
  ruleSourcePaths: string[];
  changedPaths: string[];
  hasStore: boolean;
}

export function hashRuleText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function computeRuleApplicability(
  rules: readonly CompiledRule[],
  changedPaths: readonly string[],
): {
  applicable: RuleApplicability[];
  loadedRuleText: string;
  ruleTextHash: string;
  ruleSourcePaths: string[];
} {
  const { alwaysLoad, triggered } = selectTriggeredRules(rules, changedPaths);
  const applicable: RuleApplicability[] = [
    ...alwaysLoad.map((rule) => ({
      rule_id: rule.rule_id,
      title: rule.title,
      always_load: true,
      matched_paths: [] as string[],
    })),
    ...triggered.map((rule) => ({
      rule_id: rule.rule_id,
      title: rule.title,
      always_load: false,
      matched_paths: changedPaths.filter((path) => ruleTriggersMatch(rule, [path])),
    })),
  ];
  const loadedRuleText = composeLoadedRuleText([...alwaysLoad, ...triggered]);
  return {
    applicable,
    loadedRuleText,
    ruleTextHash: hashRuleText(loadedRuleText),
    ruleSourcePaths: [...alwaysLoad, ...triggered].map((rule) => rule.source_path),
  };
}

export interface ChangeScopeOptions {
  dirName?: string | null;
}

async function changeOwnPaths(
  projectRoot: string,
  sessionId: string | null,
  scope: ChangeScopeOptions,
): Promise<string[]> {
  const since = scope.dirName ? readChangeStartPoint(projectRoot, scope.dirName) : undefined;
  const evidence = await loadChangeEvidence(projectRoot, since ? { since } : {});
  const files = evidence.files.filter((filePath) => !isPaqadArtifactPath(filePath));
  return sessionId === null ? files : subtractUnchangedBaselineFiles(projectRoot, sessionId, files);
}

export async function resolveRuleApplicabilityForChange(
  projectRoot: string,
  sessionId: string | null = null,
  scope: ChangeScopeOptions = {},
): Promise<ChangeRuleApplicability> {
  const store = await readCompiledRules(projectRoot);
  const changedPaths = await changeOwnPaths(projectRoot, sessionId, scope);
  const rules = store?.rules ?? [];
  if (rules.length === 0) {
    return {
      applicable: [],
      loadedRuleText: '',
      ruleTextHash: hashRuleText(''),
      ruleSourcePaths: [],
      changedPaths,
      hasStore: false,
    };
  }
  return { ...computeRuleApplicability(rules, changedPaths), changedPaths, hasStore: true };
}

export interface ComposeRuleContextOptions {
  changedPaths?: readonly string[];
  scriptedPaths?: ReadonlySet<string>;
}

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
  const blocks = composeLoadedRuleText(loaded);
  return `${manifest}\n${heading}\n\n${blocks}\n`;
}

export interface WriteRuleContextOptions {
  existingSurfaceSection?: string;
  memorySection?: string;
  retrievalSection?: string;
  driftSection?: string;
  loadRules?: boolean;
}

export async function writeRuleContext(
  projectRoot: string,
  options: WriteRuleContextOptions = {},
): Promise<string | null> {
  const loadRules = options.loadRules ?? true;
  const store = loadRules ? await readCompiledRules(projectRoot) : null;
  const existingSurfaceSection = loadRules ? (options.existingSurfaceSection?.trim() ?? '') : '';
  const memorySection = options.memorySection?.trim() ?? '';
  const retrievalSection = options.retrievalSection?.trim() ?? '';
  const driftSection = options.driftSection?.trim() ?? '';
  if (!store && !existingSurfaceSection && !memorySection && !retrievalSection && !driftSection)
    return null;

  let markdown = '';
  if (store) {
    const changedPaths = (await loadChangeEvidence(projectRoot)).files;
    const scriptedPaths = scriptedSourcePaths(loadRuleScriptMap(projectRoot));
    markdown = composeRuleContext(store, { changedPaths, scriptedPaths });
    if ((store.rules?.length ?? 0) > 0) {
      markdown = `${markdown}\n${DECISION_PAUSE_REMINDER}\n`;
    }
  }
  for (const section of [existingSurfaceSection, memorySection, retrievalSection, driftSection]) {
    if (section) {
      markdown = markdown ? `${markdown}\n${section}\n` : `${section}\n`;
    }
  }

  const hasRules = (store?.rules?.length ?? 0) > 0;
  if (loadRules && !hasRules) {
    markdown = `${RULES_MISSING_FALLBACK_MARKER}\n\n${markdown}`;
  }

  const target = join(projectRoot, PATHS.CONTEXT_SESSION_ARTIFACT);
  await atomicWriteFile(target, markdown);
  return target;
}

async function ensureCompiledRulesCurrent(projectRoot: string): Promise<void> {
  if (!existsSync(join(projectRoot, PATHS.RULES_DIR))) {
    return;
  }
  try {
    if (await isCompiledRulesStale(projectRoot)) {
      await writeCompiledRules(projectRoot, await compileRules(projectRoot));
    }
  } catch {}
}

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
    if (options.loadRules ?? true) {
      await ensureCompiledRulesCurrent(projectRoot);
    }
    return await writeRuleContext(projectRoot, options);
  } finally {
    releaseLock(lockDir);
  }
}
