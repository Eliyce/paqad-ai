import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import process from 'node:process';

export const CONTEXT_ARTIFACT_RELPATH = '.paqad/context/session-context.md';

export const DEFAULT_BUDGET_MS = 50;

export const DEFAULT_MAX_BYTES = 128 * 1024;

export const HOOK_OUTPUT_BUDGET_CHARS = 9000;

export const CONTEXT_TRIM_NOTICE =
  '> Context trimmed to stay under the host limit. Read .paqad/context/session-context.md for the rest.';

export const BLOCK_OPEN = '[paqad-context]';
export const BLOCK_CLOSE = '[/paqad-context]';

export function fitHookOutput(before, contextBlock, after, budget = HOOK_OUTPUT_BUDGET_CHARS) {
  const full = `${before}${contextBlock}${after}`;
  if (full.length <= budget) {
    return full;
  }
  const open = contextBlock.indexOf(BLOCK_OPEN);
  const close = contextBlock.indexOf(BLOCK_CLOSE);
  if (open === -1 || close === -1 || close < open) {
    return full;
  }
  const trailing = contextBlock.slice(close + BLOCK_CLOSE.length);
  const body = contextBlock
    .slice(open + BLOCK_OPEN.length, close)
    .replace(/^\n/, '')
    .replace(/\n$/, '');
  const fixed =
    before.length +
    after.length +
    BLOCK_OPEN.length +
    BLOCK_CLOSE.length +
    trailing.length +
    CONTEXT_TRIM_NOTICE.length +
    3;
  const bodyBudget = budget - fixed;
  const trimmedBody = bodyBudget > 0 ? body.slice(0, bodyBudget) : '';
  const rebuilt = `${BLOCK_OPEN}\n${trimmedBody}\n${CONTEXT_TRIM_NOTICE}\n${BLOCK_CLOSE}${trailing}`;
  return `${before}${rebuilt}${after}`;
}

const RAG_TRUTHY = new Set(['true', '1', 'yes', 'on']);

const LEAN_RULES_FALSY = new Set(['false', '0', 'no', 'off']);

export function isLeanRulesEnabledValue(raw) {
  if (raw === undefined || raw === null) return true;
  return !LEAN_RULES_FALSY.has(String(raw).trim().toLowerCase());
}

export function isRagEnabledValue(raw) {
  if (raw === undefined || raw === null) return false;
  return RAG_TRUTHY.has(String(raw).trim().toLowerCase());
}

export function resolveContextArtifactPath(projectRoot, env = process.env) {
  const override = env.PAQAD_CONTEXT_ARTIFACT;
  if (override && override.trim()) {
    const value = override.trim();
    return isAbsolute(value) ? value : join(projectRoot, value);
  }
  return join(projectRoot, CONTEXT_ARTIFACT_RELPATH);
}

export function readContextUnderBudget(path, options = {}) {
  const now = options.now ?? Date.now;
  const statFile = options.statFile ?? ((p) => statSync(p));
  const readFile = options.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const deadline = now() + budgetMs;

  let size;
  try {
    const stats = statFile(path);
    if (!stats || !stats.isFile()) return null;
    size = stats.size;
  } catch {
    return null;
  }
  if (size === 0) return null;
  if (now() > deadline) return null;

  let content;
  try {
    content = readFile(path);
  } catch {
    return null;
  }
  if (now() > deadline) return null;

  if (content.length > maxBytes) {
    content = `${content.slice(0, maxBytes)}\n…[paqad-context truncated at ${maxBytes} bytes]`;
  }
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const RULE_SECTION_HEADINGS = [
  '## paqad rule manifest',
  '## Loaded rule text',
  '## Existing surface',
];

export const ARTIFACT_SECTION_HEADINGS = [
  ...RULE_SECTION_HEADINGS,
  '## Decision pause is active',
  '## Codebase memory',
  '## Retrieved context',
  '## Base drift',
  '## Repo map',
];

const RULES_MISSING_MARKER_PREFIX = '> ⚠️ No compiled rules in this artifact';

export function stripRuleSections(content) {
  const kept = [];
  let dropping = false;
  for (const line of content.split('\n')) {
    if (ARTIFACT_SECTION_HEADINGS.some((heading) => line.startsWith(heading))) {
      dropping = RULE_SECTION_HEADINGS.some((heading) => line.startsWith(heading));
    }
    if (dropping || line.startsWith(RULES_MISSING_MARKER_PREFIX)) continue;
    kept.push(line);
  }
  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatContextBlock(content) {
  return `${BLOCK_OPEN}\n${content}\n${BLOCK_CLOSE}`;
}

export function buildInjection(projectRoot, options = {}) {
  const path = options.path ?? resolveContextArtifactPath(projectRoot, options.env ?? process.env);
  const read = readContextUnderBudget(path, options);
  if (read === null) return '';
  const content = options.stripRules ? stripRuleSections(read) : read;
  if (content.length === 0) return '';
  return formatContextBlock(content);
}
