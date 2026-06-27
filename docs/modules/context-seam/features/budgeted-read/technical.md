# Budgeted Artifact Read — Technical View

> Module: **Context Injection Seam** (`context-seam`) · Layer: `framework-internals` · Feature slug: `budgeted-read`

## Module Boundaries

- `runtime/scripts/context-seam.mjs` — `resolveContextArtifactPath`,
  `readContextUnderBudget`, and the constants `CONTEXT_ARTIFACT_RELPATH`,
  `DEFAULT_BUDGET_MS`, `DEFAULT_MAX_BYTES`.

## Entry Points

- `resolveContextArtifactPath(projectRoot, env?)` — default
  `.paqad/context/session-context.md`, overridable via `PAQAD_CONTEXT_ARTIFACT`
  (absolute or project-relative).
- `readContextUnderBudget(path, options?)` — returns the trimmed content string
  or `null` when there is nothing safe to emit.

## Data Model / Schema

`options` (all injectable for deterministic tests):
`{ now?: () => number, statFile?: (p) => Stats, readFile?: (p) => string, budgetMs?: number, maxBytes?: number }`.
Defaults: `now = Date.now`, real `statSync`/`readFileSync`, `budgetMs = 50`,
`maxBytes = 128 * 1024`.

## API / Interface Contract

`readContextUnderBudget` decision order:

1. Seed `deadline = now() + budgetMs`.
2. `statFile(path)` → `null` on throw, not-a-file, or `size === 0`.
3. `now() > deadline` after stat → `null` (filesystem already too slow).
4. `readFile(path)` → `null` on throw.
5. `now() > deadline` after read → `null` (read overran the budget).
6. Truncate to `maxBytes` with a `…[paqad-context truncated at N bytes]` marker
   if longer, then `trim()`; return `null` if the result is empty.

## State Management

- Stateless and side-effect-free: one read, no writes. The artifact's freshness
  is owned by the background-worker harness, not this read path.

## Failure Modes

- Missing/unreadable/empty/whitespace artifact → `null` (the today-behavior path).
- Slow filesystem → `null` rather than a stalled prompt.
- Oversized artifact → truncated, never injected wholesale.

## Tests

- `tests/unit/runtime/context-seam.test.ts` — path resolution (default, absolute
  override, relative override, blank override); read returns trimmed content;
  `null` on missing/empty/whitespace/non-file; budget-blown-by-stat skips the
  read; budget-blown-by-read drops content; over-ceiling truncation marker.
