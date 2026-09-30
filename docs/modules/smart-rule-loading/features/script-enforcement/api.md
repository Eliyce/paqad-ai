# Script Enforcement — API View

> Module: **Smart Rule Loading** (`smart-rule-loading`) · Layer: `framework-internals` · Feature slug: `script-enforcement`

The public surface downstream callers (the capability kernel, the hook, tests)
depend on. Types live in `src/rule-scripts/`.

## `enforceRuleScripts(input)`

```ts
enforceRuleScripts(input: {
  projectRoot: string;
  mode: 'off' | 'warn' | 'strict';
  changedFiles?: string[];
  scope?: 'changed-files' | 'whole-tree';
}): EnforcementResult;
```

Resolves the working set (via `loadChangeEvidence` when `changedFiles` is
omitted), runs the registered rule scripts, and flattens the deterministic
findings.

- **Returns** `EnforcementResult { ran, mode, blocking, violations, armed, summary }`.
- `blocking` is `mode === 'strict' && deterministic findings > 0`.
- `violations: RuleViolation[]` — `{ rule_id, script, file, line?, message, severity }`.
- `ran: false` (fast no-op) when there is no rule-script map or `mode === 'off'`.
- **Empty change set (issue #580).** `scope` defaults to `changed-files`: an empty
  working set means nothing changed this turn, so enforcement is skipped
  (`ran: false`, summary `⚪ scripted rules: skipped (no files changed this turn)`)
  rather than falling through to a whole-tree scan that would block on pre-existing
  debt. The capability kernel passes `changed-files` at the **completion** seam and
  `whole-tree` at the **pre-mutation** seam; an explicit full scan
  (`checks run` / `health run`) uses `whole-tree`, where an empty set still scans the
  whole tree.

## `formatEnforcementSummary(result)`

```ts
formatEnforcementSummary(result: EnforcementResult): string;
```

Renders the result as paqad-voice markdown for the hook / chat surface.

## `runRuleScripts(opts)`

```ts
runRuleScripts(opts: {
  projectRoot: string;
  mode: 'off' | 'warn' | 'strict';
  changedFiles?: string[];
  wholeTreeGlobs?: string[];
}): RunReport;
```

The engine underneath `enforceRuleScripts`. Hash-caches its `RunReport` under
`.paqad/`.

- **Whole-tree scope.** `changed-files` scripts run against `changedFiles`;
  whole-tree / git-diff / git-history scripts (and changed-files scripts with no
  diff) run against the whole-tree enumeration. That enumeration applies a static
  ignore list (`node_modules`, `dist`, `.paqad`, `build`, `vendor`) **and** drops
  git-ignored paths via a batched `git check-ignore`, so gitignored build output,
  vendored deps, and generated code are never scanned. If git is unavailable or
  the project is not a repo, it falls back to the static list alone.
- **`RunReport`** `{ generated_at, mode, rule_files_hash, script_files_hash, target_files_hash, results, counts, blocking, from_cache? }`.

## Hook contract

- Entry: `runtime/hooks/capability-gate.mjs <seam>` where `seam` is
  `pre-mutation` | `completion`. Lazy-imports `dist/kernel/gate.js` only after the
  pure-mjs fast-paths (paqad-disabled, mode `off`, missing rule-script map).
- Exit codes: blocking → `2` (stderr); advisory (warn) findings → `0` (stdout);
  otherwise `0`. Any thrown error soft-fails to `0`.
