# Trigger-Load — Technical View

> Module: **Smart Rule Loading** (`smart-rule-loading`) · Layer: `framework-internals` · Feature slug: `trigger-load`

## Module Boundaries

- `src/context/rule-context.ts` — `selectTriggeredRules`, `composeRuleContext`,
  `writeRuleContext`, `refreshRuleContext`.
- `src/pipeline/rule-trigger-matcher.ts` — `isAlwaysLoadRule`, `ruleTriggersMatch`,
  `matchesGlobish`.
- `src/cli/commands/rag.ts` — `rag refresh-context` (the background worker entry).
- `runtime/hooks/context-refresh-trigger.mjs` — prompt-time debounced trigger.

## Entry Points

- `selectTriggeredRules(rules, changedPaths)` → `{ alwaysLoad, triggered }` (pure).
- `composeRuleContext(store, { changedPaths, scriptedPaths })` → manifest +
  loaded-rule-text markdown (pure).
- `writeRuleContext(projectRoot)` → lock-free compose + atomic write (used at
  onboarding, no concurrency).
- `refreshRuleContext(projectRoot)` → `writeRuleContext` under the F1 single-flight
  lock (the background worker).

## Data Model / Schema

- Always-load = `trigger_patterns` is empty or contains `**`.
- A scoped rule is loaded when `ruleTriggersMatch(rule, changedPaths)`.
- Working-set paths come from `loadChangeEvidence` (session tracker → git status).
- Loaded text uses each rule's `raw_text` (falls back to `summary`).

## API / Interface Contract

- Onboarding calls `writeRuleContext` (lock-free) so it leaves no empty lock dir.
- The prompt hook (`context-refresh-trigger.mjs`) debounces on a `.paqad/locks/`
  marker (20s), then detached-spawns `paqad-ai rag refresh-context --quiet`. The
  CLI single-flights via `refreshRuleContext`. Both gates (paqad-disabled,
  `rag_enabled`) apply before any spawn.
- The seam reads the resulting artifact; the refresh lands on the next prompt
  (stale-while-revalidate).

## State Management

- The single-flight lock (`.paqad/locks/rule-context.lock`) serialises concurrent
  refreshes; its parent `.paqad/locks` is shared and left in place.
- Atomic write (background harness) guarantees readers never see a partial file.

## Failure Modes

- Lock held by another refresh → `refreshRuleContext` returns `null` (no clobber).
- No compiled rules AND no other section → `null`, nothing written (the bootstrap's
  "load full rules when the artifact is missing" clause then applies).
- Rules-less but a section is written (drift / memory / retrieval present, store
  absent or empty) → the artifact is prepended with `RULES_MISSING_FALLBACK_MARKER`
  (issue #316) so a bootstrap-obedient reader never mistakes a rules-less file for a
  "rules loaded" contract and always loads `docs/instructions/rules/` in full. A
  populated store keeps its manifest and is byte-identical to before.
- `paqad-ai` missing on PATH → the trigger's spawn errors are swallowed.

## Tests

- `tests/unit/context/rule-context.test.ts` — selection (always-load, scoped
  match/no-match, empty working set); compose (loaded text for matched +
  always-load only, manifest-only floor); refresh (writes artifact, null with no
  rules, no-op when locked, end-to-end via the seam hook).
- `tests/unit/runtime/context-refresh-trigger.test.ts` — stamps the marker when
  rag on; no-op when rag off / paqad disabled; silent, never errors.
