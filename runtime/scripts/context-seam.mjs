// context-seam.mjs — the session-time injection seam (RAG buildout F2).
//
// This is the delivery channel everything downstream rides on: it reads a
// PRECOMPUTED context artifact off disk and formats it as a `[paqad-context]`
// block that a UserPromptSubmit hook emits on stdout, so the host injects it
// into the model context before the turn is planned.
//
// Hard constraints (FEATURES.md) this module is built to honour:
//   - Complement, never block. The seam does NO heavy work — only a stat + read
//     of a precomputed file, under a hard time budget. Embedding/indexing/sync
//     are the background harness's job (F1/F9); the prompt path only reads the
//     finished artifact.
//   - Save tokens. The artifact is already a sliced/budgeted payload produced by
//     upstream (the rule manifest F4, retrieval F11/F13, memory F21). `maxBytes`
//     here is only a runaway-file ceiling, not the real token budget.
//   - Disabled / cold start == today. A missing, empty, or too-slow-to-read
//     artifact yields NOTHING; the agent proceeds with grep/read exactly as
//     before (F3 makes this an explicit equivalence guarantee).
//
// Every external effect (clock, stat, read) is an injectable seam so the logic
// is deterministic under test — mirroring the background harness's TriggerDeps.

import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import process from 'node:process';

/** Default on-disk location of the precomputed context artifact, project-relative. */
export const CONTEXT_ARTIFACT_RELPATH = '.paqad/context/session-context.md';

/**
 * Read deadline in ms. The read is a single sync `readFileSync` of a small
 * precomputed file, so this is a guard against pathological filesystem latency:
 * if the stat/read overruns it, the seam emits nothing rather than stalling the
 * prompt path.
 */
export const DEFAULT_BUDGET_MS = 50;

/**
 * Runaway-file ceiling. Upstream is responsible for keeping the artifact within
 * a sane TOKEN budget; this only stops a corrupt/huge file from being injected
 * wholesale. Content above this is truncated with a visible marker.
 */
export const DEFAULT_MAX_BYTES = 128 * 1024;

/**
 * Host output cap for a UserPromptSubmit hook (issue #615, Part 3). Claude Code caps a
 * hook's `additionalContext` / `systemMessage` / plain stdout at 10,000 CHARACTERS; anything
 * longer is saved to a file and replaced with a preview the model never reads. This budget
 * leaves ~1,000 characters of headroom under that cap, so the prompt gate's whole output
 * (route line + context block + nudge) stays visible. Counted in characters, not bytes.
 */
export const HOOK_OUTPUT_BUDGET_CHARS = 9000;

/** The verbatim line that replaces the trimmed tail of the context block (issue #615, Part 3). */
export const CONTEXT_TRIM_NOTICE =
  '> Context trimmed to stay under the host limit. Read .paqad/context/session-context.md for the rest.';

/** The fenced block markers the host injects verbatim. */
export const BLOCK_OPEN = '[paqad-context]';
export const BLOCK_CLOSE = '[/paqad-context]';

/**
 * Fit the prompt hook's output under {@link HOOK_OUTPUT_BUDGET_CHARS} (issue #615, Part 3).
 * `before` (the route line(s)) and `after` (the spec-pipeline nudge) are kept whole; only the
 * `[paqad-context]` BODY is trimmed, to the longest prefix that still leaves room for the
 * markers, the trim notice, and the kept pieces. The context block ends with the trim notice.
 * Lengths are counted in characters. Returns the full string to emit.
 *
 * @param {string} before   text emitted before the context block (route line / session prefix).
 * @param {string} contextBlock  the `[paqad-context]…[/paqad-context]` block (may end in a newline).
 * @param {string} after    text emitted after the context block (the nudge line).
 * @param {number} [budget] the character budget (defaults to the host cap headroom).
 * @returns {string}
 */
export function fitHookOutput(before, contextBlock, after, budget = HOOK_OUTPUT_BUDGET_CHARS) {
  const full = `${before}${contextBlock}${after}`;
  if (full.length <= budget) {
    return full;
  }
  const open = contextBlock.indexOf(BLOCK_OPEN);
  const close = contextBlock.indexOf(BLOCK_CLOSE);
  if (open === -1 || close === -1 || close < open) {
    // No parseable context block to trim; the route line and nudge are already small, so there
    // is nothing more we can safely drop — emit what we have.
    return full;
  }
  const trailing = contextBlock.slice(close + BLOCK_CLOSE.length); // usually a trailing "\n"
  const body = contextBlock
    .slice(open + BLOCK_OPEN.length, close)
    .replace(/^\n/, '')
    .replace(/\n$/, '');
  // Everything except the trimmed body: the kept pieces, the markers, the three newlines, and
  // the trim notice. The body gets whatever budget remains.
  const fixed =
    before.length +
    after.length +
    BLOCK_OPEN.length +
    BLOCK_CLOSE.length +
    trailing.length +
    CONTEXT_TRIM_NOTICE.length +
    3; // "\n" after open, "\n" after body, "\n" after the notice
  const bodyBudget = budget - fixed;
  const trimmedBody = bodyBudget > 0 ? body.slice(0, bodyBudget) : '';
  const rebuilt = `${BLOCK_OPEN}\n${trimmedBody}\n${CONTEXT_TRIM_NOTICE}\n${BLOCK_CLOSE}${trailing}`;
  return `${before}${rebuilt}${after}`;
}

/** `rag_enabled` tokens that mean ON (mirrors the framework-config boolean parse). */
const RAG_TRUTHY = new Set(['true', '1', 'yes', 'on']);

/** `lean_rules` tokens that mean OFF (mirrors the framework-config boolean parse). */
const LEAN_RULES_FALSY = new Set(['false', '0', 'no', 'off']);

/**
 * Interpret a raw layered `lean_rules` value (issue #284 — token-neutral rule
 * loading). Unlike `rag_enabled`, the default is ON: paqad ships the lean rule
 * contract (manifest + trigger-loaded applicable rule text) as the default delivery
 * path, so an unset value resolves to `true`. Only an explicit falsy token
 * (`false`/`0`/`no`/`off`) turns it off and restores the full-load behaviour.
 *
 * @param {string | undefined} raw the value resolved across the config layers.
 * @returns {boolean}
 */
export function isLeanRulesEnabledValue(raw) {
  if (raw === undefined || raw === null) return true;
  return !LEAN_RULES_FALSY.has(String(raw).trim().toLowerCase());
}

/**
 * Interpret a raw layered `rag_enabled` value (RAG buildout F3 — the master
 * switch for the injection accelerator). Default is OFF: paqad ships the honest
 * grep/agentic default (`FRAMEWORK_CONFIG_SPECS` `rag_enabled` default = false),
 * so an unset value emits nothing and the agent behaves exactly as today. Only an
 * explicit truthy token turns injection on.
 *
 * @param {string | undefined} raw the value resolved across the config layers.
 * @returns {boolean}
 */
export function isRagEnabledValue(raw) {
  if (raw === undefined || raw === null) return false;
  return RAG_TRUTHY.has(String(raw).trim().toLowerCase());
}

/**
 * Resolve where the precomputed context artifact lives.
 *
 * `PAQAD_CONTEXT_ARTIFACT` overrides the default path (absolute, or relative to
 * the project root). The override keeps the seam testable and lets a host point
 * at a provider-specific artifact location without touching this code.
 */
export function resolveContextArtifactPath(projectRoot, env = process.env) {
  const override = env.PAQAD_CONTEXT_ARTIFACT;
  if (override && override.trim()) {
    const value = override.trim();
    return isAbsolute(value) ? value : join(projectRoot, value);
  }
  return join(projectRoot, CONTEXT_ARTIFACT_RELPATH);
}

/**
 * Read the artifact's content under a hard time budget, returning the trimmed
 * text or `null` when there is nothing safe to emit.
 *
 * Returns `null` (→ emit nothing → today's behaviour) when:
 *   - the file is missing, not a regular file, or unreadable;
 *   - the file is empty or whitespace-only;
 *   - the stat/read overruns the time budget.
 *
 * Content longer than `maxBytes` is truncated with a visible marker so a runaway
 * artifact can never dump unbounded text into the model context.
 *
 * @param {string} path absolute path to the artifact.
 * @param {object} [options]
 * @param {() => number} [options.now] clock seam (defaults to `Date.now`).
 * @param {(p: string) => import('node:fs').Stats} [options.statFile]
 * @param {(p: string) => string} [options.readFile]
 * @param {number} [options.budgetMs]
 * @param {number} [options.maxBytes]
 * @returns {string | null}
 */
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
    // Missing or unreadable → cold start / disabled == today: emit nothing.
    return null;
  }
  if (size === 0) return null;
  // Filesystem already too slow before we even read → skip, never block.
  if (now() > deadline) return null;

  let content;
  try {
    content = readFile(path);
  } catch {
    return null;
  }
  // The read itself overran the budget → skip rather than emit late.
  if (now() > deadline) return null;

  if (content.length > maxBytes) {
    content = `${content.slice(0, maxBytes)}\n…[paqad-context truncated at ${maxBytes} bytes]`;
  }
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The artifact sections that belong to the feature-development rule contract (issue #582,
 * FR-9). The artifact is shared by every session in a checkout and may have been composed
 * for another session's feature-development prompt, so a prompt routed elsewhere drops these.
 */
export const RULE_SECTION_HEADINGS = [
  '## paqad rule manifest',
  '## Loaded rule text',
  '## Existing surface',
];

/**
 * Every top-level heading the artifact composer writes. A section runs from one of these to
 * the next one. Other `## ` lines are NOT boundaries, because the loaded rule text embeds each
 * rule's own markdown (for example a rule's `## Verify` heading), which must be dropped with
 * the rest of the rule text rather than end the section early.
 */
export const ARTIFACT_SECTION_HEADINGS = [
  ...RULE_SECTION_HEADINGS,
  '## Decision pause is active',
  '## Codebase memory',
  '## Retrieved context',
  '## Base drift',
  '## Repo map',
];

/** The #316 "no compiled rules, load them in full" marker; rule-contract only as well. */
const RULES_MISSING_MARKER_PREFIX = '> ⚠️ No compiled rules in this artifact';

/**
 * Remove the rule-contract sections (and the #316 rules-missing marker) from artifact content,
 * keeping every other section byte-for-byte. Returns the trimmed remainder, or `''` when
 * nothing is left.
 *
 * @param {string} content the artifact content (without the block markers).
 * @returns {string}
 */
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

/** Wrap precomputed content in the `[paqad-context]` block the host injects. */
export function formatContextBlock(content) {
  return `${BLOCK_OPEN}\n${content}\n${BLOCK_CLOSE}`;
}

/**
 * End-to-end seam: resolve the artifact, read it under budget, and return the
 * `[paqad-context]` block to emit — or an empty string when there is nothing to
 * inject (the read-only, non-blocking default path).
 *
 * @param {string} projectRoot
 * @param {object} [options] forwarded to {@link readContextUnderBudget}, plus an
 *   optional `path` override, `env` for path resolution, and `stripRules` (issue #582)
 *   to drop the rule-contract sections for a prompt that is not feature-development.
 * @returns {string} the block, or `''`.
 */
export function buildInjection(projectRoot, options = {}) {
  const path = options.path ?? resolveContextArtifactPath(projectRoot, options.env ?? process.env);
  const read = readContextUnderBudget(path, options);
  if (read === null) return '';
  const content = options.stripRules ? stripRuleSections(read) : read;
  if (content.length === 0) return '';
  return formatContextBlock(content);
}
