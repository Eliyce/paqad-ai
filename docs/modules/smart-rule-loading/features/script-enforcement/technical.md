# Script Enforcement — Technical View

> Module: **Smart Rule Loading** (`smart-rule-loading`) · Layer: `framework-internals` · Feature slug: `script-enforcement`

## Module Boundaries

- `src/rule-scripts/enforce.ts` — `enforceRuleScripts`, `formatEnforcementSummary`.
- `runtime/hooks/rule-script-enforce.mjs` — the PreToolUse + Stop hook entry.
- `src/adapters/claude/claude-adapter.ts` — registers the hook.

## Entry Points

- `enforceRuleScripts({ projectRoot, mode, changedFiles? })` → `EnforcementResult`
  `{ ran, mode, blocking, violations, summary }`. Wraps `runRuleScripts`; resolves
  the working set via `loadChangeEvidence` when `changedFiles` is omitted.
- `formatEnforcementSummary(result)` → paqad-voice markdown.

## Data Model / Schema

- `RuleViolation { rule_id, script, file, line?, message, severity }` — the
  flattened deterministic findings.
- `blocking = mode === 'strict' && deterministic findings > 0` (from the runner).
- Mode resolved by the hook from layered `rule_compliance` / `PAQAD_RULE_COMPLIANCE`
  (default `warn`).

## API / Interface Contract

- The hook runs pure-mjs gates first — paqad-disabled, mode `off`, and a missing
  `docs/instructions/rules/rule-script-map.yml` — so the common no-map case never
  pays the dist import. Only then does it lazy-import
  `dist/rule-scripts/index.js` (resolved relative to the module, like
  `verify-backstop.mjs`).
- Exit codes: strict + blocking → 2 (stderr); warn + findings → 0 (stdout);
  otherwise 0. Any thrown error soft-fails to 0.
- Registered by the Claude adapter on `PreToolUse` (Edit|Write|NotebookEdit) and
  `Stop`. `PAQAD_LIVE_HOOKS` is intentionally untouched (cross-provider rollout is
  a follow-up).

## State Management

- Stateless wrapper; the runner owns its hash-cached report under `.paqad/`.

## Failure Modes

- No rule-script map / mode off → `ran: false`, no enforcement (fast no-op).
- Infra error in the hook → soft-fail exit 0; git/CI backstop still enforces.

## Tests

- `tests/unit/rule-scripts/enforce.test.ts` — blocks under strict with the rule
  text not loaded; warn surfaces without blocking; clean passes; fast-skip with no
  map and with mode off; summary capping.
- `tests/unit/runtime/rule-script-enforce.test.ts` — the hook's gating fast-paths
  (no map, paqad disabled, mode off) all exit 0 silently.
- `tests/unit/adapters/claude/agent-entry-gate.test.ts` — the hook is registered
  on PreToolUse and Stop.
