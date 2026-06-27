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

/** The fenced block markers the host injects verbatim. */
export const BLOCK_OPEN = '[paqad-context]';
export const BLOCK_CLOSE = '[/paqad-context]';

/** `rag_enabled` tokens that mean ON (mirrors the framework-config boolean parse). */
const RAG_TRUTHY = new Set(['true', '1', 'yes', 'on']);

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
 *   optional `path` override and `env` for path resolution.
 * @returns {string} the block, or `''`.
 */
export function buildInjection(projectRoot, options = {}) {
  const path = options.path ?? resolveContextArtifactPath(projectRoot, options.env ?? process.env);
  const content = readContextUnderBudget(path, options);
  if (content === null) return '';
  return formatContextBlock(content);
}
