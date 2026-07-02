# Script Enforcement — Technical View

> Module: **Smart Rule Loading** (`smart-rule-loading`) · Layer: `framework-internals` · Feature slug: `script-enforcement`

## Module Boundaries

- `src/rule-scripts/enforce.ts` — `enforceRuleScripts`, `formatEnforcementSummary`.
- `src/kernel/capability.ts` — the `rule-scripts` capability wrapping
  `enforceRuleScripts`; the first contract folded into the capability-kernel seam
  (buildout F3). `src/kernel/gate.ts` — `runCapabilityGate`, the executor.
- `src/rule-scripts/integrity.ts` — `computeRuleScriptsDigest` (hash-only
  fingerprint of map + scripts). `src/kernel/capability-lock.ts` — the
  engine-owned `.paqad/capability-lock.json` recording the blessed per-capability
  digest (buildout F5, decision D1 audit).
- `runtime/hooks/capability-gate.mjs` — the PreToolUse + Stop hook entry (the
  shared kernel seam; replaces the retired single-purpose
  `rule-script-enforce.mjs`).
- `src/adapters/claude/claude-adapter.ts` — registers the hook.
- `src/rule-scripts/rule-ledger.ts` — rule-compliance evidence on the
  session-ledger (buildout F6, decision D1 hard cutover). The runner records a
  `findings` row (mirrors `report.json`'s counts) and the reconciler a `drift` row
  (mirrors `drift.json`'s `blocked` + counts) to a project-scoped `rule-evidence`
  doc; the dashboard `collectRuleCompliance` reads them from the ledger, not the
  cache files. The `report.json` / `drift.json` caches STAY (the engine reads them
  for cache validity); the ledger is the evidence read for the dashboard + SIEM.
  Shared substrate helper: `src/session-ledger/project-ledger.ts`.

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
  (default `warn`), floored — the team value is a floor; local/env may only RAISE.
- **Integrity (buildout F5, decision D1 audit).** The engine writes a digest of the
  blessed map + scripts into `.paqad/capability-lock.json` at apply time (the
  single-writer path in `apply.ts`). Before enforcing, the rule-scripts capability
  recomputes the live digest and compares: `ok` → enforce normally; `tampered`
  (lock present, digest differs → hand-edited outside the engine) → strict blocks
  with the tamper verdict (the bindings can't be trusted, a weakening may be
  hidden), warn surfaces; `unverified` (map present, no lock — a pre-F5 map) →
  still enforces but adds an advisory, never blocks. The check is hash-only (no
  script execution), safe on the per-edit seam; the reconciler's `RS-FIXTURE-FAIL`
  still owns the heavier "script no longer passes its fixtures" check at planning.
  Tamper-evident, not tamper-proof: the lock is a tracked project file, so it
  catches edits that bypass the engine, not a coordinated edit of both.

## API / Interface Contract

- The hook runs pure-mjs gates first — paqad-disabled, mode `off`, and a missing
  `docs/instructions/rules/rule-script-map.yml` — so the common no-map case never
  pays the dist import. Only then does it lazy-import `dist/kernel/gate.js` and
  call `runCapabilityGate({ projectRoot, seam })` (resolved relative to the module,
  like `verify-backstop.mjs`). The seam (`pre-mutation` | `completion`) is the
  hook's first argv.
- Exit codes: a blocking outcome → 2 (stderr); advisory (warn) findings → 0
  (stdout); otherwise 0. Any thrown error soft-fails to 0.
- Registered by the Claude adapter on `PreToolUse` (Edit|Write|NotebookEdit,
  `pre-mutation` seam) and `Stop` (`completion` seam). `PAQAD_LIVE_HOOKS` is
  intentionally untouched (cross-provider rollout of the kernel seam is a
  follow-up).

## State Management

- Stateless wrapper; the runner owns its hash-cached report under `.paqad/`.

## Failure Modes

- No rule-script map / mode off → `ran: false`, no enforcement (fast no-op).
- Infra error in the hook → soft-fail exit 0; git/CI backstop still enforces.
- Whole-tree scan honours `.gitignore`. `runner.ts` enumerates the tree with a
  static ignore list (`node_modules`, `dist`, `.paqad`, `build`, `vendor`) and
  then drops git-ignored paths via a single batched `git check-ignore`, so
  gitignored build output / vendored deps / generated code are never scanned and
  can't raise `deterministic` findings that block the strict gate on files the
  developer can't hand-fix. Best-effort: git missing or not-a-repo falls back to
  the static list alone. `check-ignore` respects the index, so tracked source
  that merely matches an ignore pattern is still scanned.

## Tests

- `tests/unit/rule-scripts/enforce.test.ts` — blocks under strict with the rule
  text not loaded; warn surfaces without blocking; clean passes; fast-skip with no
  map and with mode off; summary capping.
- `tests/unit/runtime/capability-gate.test.ts` — the hook's gating fast-paths
  (no map, paqad disabled, mode off) all exit 0 silently, on both seams.
- `tests/unit/kernel/gate.test.ts` — `runCapabilityGate` runs the rule-scripts
  capability and aggregates the block/allow decision; F5 integrity (lock written on
  apply, tamper blocks under strict / surfaces under warn, no-lock advisory).
- `tests/unit/kernel/capability-lock.test.ts` — the engine-owned lock read/write
  (null-safe, merge-preserving). `tests/unit/rule-scripts/integrity.test.ts` — the
  digest is null with no map and changes when the map or a script changes.
- `tests/unit/adapters/claude/agent-entry-gate.test.ts` — the capability-gate hook
  is registered on PreToolUse and Stop, and the retired rule-script-enforce hook is
  pruned on re-onboard.
