# Script Enforcement — Technical View

> Module: **Smart Rule Loading** (`smart-rule-loading`) · Layer: `framework-internals` · Feature slug: `script-enforcement`

## Module Boundaries

- `src/rule-scripts/enforce.ts` — `enforceRuleScripts`, `formatEnforcementSummary`.
- `src/rule-scripts/runner.ts` — `runRuleScripts` (sync, the public `paqad-ai/rule-scripts`
  export and the rule-script-runner skill) and `runRuleScriptsAsync` (the pool the gate uses).
  Both share one preparation, cache check and report writer. `src/core/run-pool.ts` is the
  shared pool (also used by the checks scheduler).
- `src/rule-scripts/file-cache.ts` — the per-file results cache for `per_file: true` scripts.
- `src/rule-scripts/pending-marker.ts` — the session-owned pending-pre-mutation marker.
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
- Rule-compliance evidence lives in the per-feature bundle (the retired project-scoped `rule-evidence` doc and `src/rule-scripts/rule-ledger.ts`
  are gone). The runner records a `findings` row (mirrors `report.json`'s counts) via
  `appendRuleRun` into the active feature's `rule-run.jsonl`; the reconciler records a `drift`
  row (mirrors `drift.json`'s `blocked` + counts) the same way. The dashboard
  `collectRuleCompliance` reads findings from the bundle projection (`readAllFeatureRuleRuns`)
  and drift live from the `drift.json` cache. The `report.json` / `drift.json` caches STAY
  (the engine reads them for cache validity, and the evidence-existence backfill mints missing
  bundle rows from them). Bundle writer: `src/feature-evidence/bundle-ledgers.ts`.

## Entry Points

- `enforceRuleScripts({ projectRoot, mode, changedFiles?, scope?, kinds?, scopes?, concurrency?,
  signal?, useFileCache? })` → `EnforcementResult` `{ ran, mode, blocking, violations, armed,
  summary, aborted? }`. Wraps `runRuleScriptsAsync`; resolves the working set via
  `loadChangeEvidence` when `changedFiles` is omitted. `scope` (default `changed-files`)
  decides how an EMPTY working set is treated: a `changed-files` scope skips (`ran: false`,
  `⚪ skipped (no files changed this turn)`) so a clean tree never triggers a whole-tree block,
  while `whole-tree` scans the whole tree. A `scopes` filter of only `changed-files` also skips
  on an empty working set, so nothing scans the tree before an edit. `kinds` and `scopes` pick
  which scripts run; scripts outside them are not run at all. `concurrency` defaults to the
  `rule_gate_concurrency` setting. An aborted `signal` returns `aborted: true` with no
  verdict, and nothing is written to the report.
- The capability kernel passes `{ kinds: ['deterministic'], scopes: ['changed-files'] }`, the
  file cache and an abort signal at pre-mutation (scope `whole-tree`), and no filter at
  completion (scope `changed-files`). Under `rule_gate_pre_edit=all` pre-mutation passes no
  filter and no file cache, which is the old behaviour.
- `formatEnforcementSummary(result)` → paqad-voice markdown.

## Data Model / Schema

- `report.json` holds the unfiltered (turn-end) run; `report.pre-mutation.json` holds the
  filtered pre-edit run and records its `filter`. Both sit in `.paqad/scripts/rules/.cache/`
  and are written with write-then-rename, so the two runs never evict each other and a reader
  never sees a torn file. A cached report is reused only when the mode, the hashes and the filter
  all match.
- `file-results.json` (same folder) holds one entry per script and file: script path, script
  sha256, file path, file sha256 and that file's findings. Only scripts whose header says
  `// per_file: true` use it, and only the pre-edit run under `blocking-only` reads or writes
  it. A run splits a script's targets into cached and dirty files, spawns the script on the dirty
  files only (not at all when none are dirty) and merges the cached findings back in target
  order. An errored run, or one that reports a finding for a file it was not given, is not
  cached. Entries whose script or file content no longer matches, or whose file is gone, are
  dropped on every write. A corrupt or unreadable file reads as empty.
- `pending-pre-mutation/<session>.json` (same folder), plus a copy beside the session's
  `.workflow-state.json` in the stage-evidence ledger, records `{ session_id, change,
  written_at, files }` when the pre-edit budget ran out.

- `RuleViolation { rule_id, script, file, line?, message, severity }` — the
  flattened deterministic findings.
- `blocking = mode === 'strict' && deterministic findings > 0` (from the runner).
- Mode resolved by `resolveRuleComplianceMode` from layered, floored surfaces
  (default `warn`; local `.config` / `PAQAD_RULE_COMPLIANCE` may only RAISE). The
  team FLOOR is the stricter of the merged `configs/.config.*` `rule_compliance`
  value and the project's own `feature-development.yaml`
  `checks.rule_compliance.mode`. The workflow-yaml knob used to be a
  placebo — read into the policy object but ignored by the resolver — so a team that
  set `strict` there silently got `warn`; it is now a real input. The resolver reads
  the RAW on-disk workflow file (an explicit team decision), not the merged policy,
  so the framework default is not force-flipped to strict.
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
- At the `completion` seam, rule-scripts run only when
  `classifyCompletionEnforcement` (`src/pipeline/session-ownership.ts`)
  says this session's turn is due its checks, the same decision the Stop backstop
  uses, or when this session has a pending-pre-mutation marker. A session that owns no
  change, or an owner on a non-feature turn that edited nothing, runs no rule-scripts
  unless it has a marker. The session id comes from the hook payload, else
  `CLAUDE_SESSION_ID`.
- Pre-edit budget: the hook passes the time it started (`startedAt`) through
  `runCapabilityGate` to the capability, which aborts the run at `startedAt +
  rule_gate_budget_ms` (an injected `now` clock is used in tests). An abort kills every rule
  script still running. Only then is the edit allowed: the capability writes the marker, logs
  `capability-gate rule-scripts budget-exhausted session=<id> files=<n>` to hooks.log and
  returns the context line `paqad: the blocking rule checks did not finish in time for this
  edit. They will run again at the end of this turn and block there if anything fails.`, which
  the hook prints as PreToolUse `additionalContext` (`CapabilityOutcome.context`, appended
  before the visual-evidence reminder). If the marker cannot be written the edit is refused
  (`pending-unwritable <code>` in hooks.log). A crash, a script's own 30 s timeout, malformed
  output and a tampered script keep their old outcome; they never take the budget path.
- The turn end clears the marker after a run that finished; a failure there blocks the turn and
  the agent fixes forward (no automatic undo). Deleting the marker in the cache folder does not
  skip the check, because the copy in the session's ledger folder still counts. Another session's
  marker is never read.
- Exit codes: a blocking outcome → 2 (stderr); advisory (warn) findings → 0
  (stdout); otherwise 0. Any thrown error soft-fails to 0.
- Registered by the Claude adapter on `PreToolUse` (Edit|Write|NotebookEdit,
  `pre-mutation` seam) and `Stop` (`completion` seam). `PAQAD_LIVE_HOOKS` is
  intentionally untouched (cross-provider rollout of the kernel seam is a
  follow-up).

## Map generation

- `src/rule-scripts/compile.ts` — `compileRuleScripts(projectRoot)` GENERATES the
  `rule-script-map.yml` the whole engine depends on. It reuses the analyzer's
  deterministic mechanics (`scanAndEmbedIds` to embed stable rule ids,
  `assembleMap` to list every rule) and the atomic writer (`applyRuleScriptMap`).
  It authors no scripts and makes no judgement (that is the rule-analyzer skill);
  scripts already bound carry over for rules whose text is unchanged. Idempotent.
- `src/cli/commands/rules.ts` — `paqad-ai rules compile`, the verb the agent runs
  mid-turn / re-runs on rule changes.
- The onboarding orchestrator invokes `compileRuleScripts` after the rule tree is
  written and before the rule-context write, so a fresh project ships with the map
  and the gate is ARMED. Previously nothing produced the map, so enforcement
  fast-skipped on the missing map and the gate passed by default — the engine was
  built but disarmed.

## Configuration

All three keys are policy-group knobs read through `resolveRuleGateConfig` (the layered config
reader; local beats team, `PAQAD_*` env beats both). A bad value never loosens the gate.

| Key | Default | Meaning |
| --- | --- | --- |
| `rule_gate_pre_edit` | `blocking-only` | `blocking-only` runs only deterministic changed-files scripts before an edit; `all` runs every script, as before. An unknown value reads as `blocking-only`. |
| `rule_gate_concurrency` | `auto` | Scripts run at once. `auto` is CPU cores minus one, between 1 and 8. A number is capped at 8; zero, negative or non-numeric reads as `auto`. |
| `rule_gate_budget_ms` | `6000` | Time the pre-edit check may take, counted from the hook start. Zero, negative or non-numeric reads as 6000; other values are clamped to 500-9000 ms so the check ends before the 10 s hook timeout. The budget also applies under `all`. |

The rollback is `rule_gate_pre_edit=all` plus `rule_gate_concurrency=1`: every script before
an edit, one after another in map order, with the budget still applied. The hook registration
(`capability-gate-pre-mutation`, `failClosed: true`, `timeoutSec: 10`) is unchanged.

## State Management

- Stateless wrapper; the runner owns its hash-cached reports, the per-file cache and the
  pending markers under `.paqad/scripts/rules/.cache/`.

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

## Why the rule-scripts engine works the way it does

The reasons below are not obvious from the code in `src/rule-scripts/`.

- **Ids and markers (`rule-id.ts`, `rule-file.ts`, `editor.ts`).** A rule is a markdown bullet
  under `docs/instructions/rules/` outside a fenced code block. It gets an opaque `RL-<hex>` id as
  a trailing HTML comment marker, which is invisible when rendered and survives reformatting. The
  id stays stable because the marker is persisted in the file, not because the hash ignores edits,
  so a rule keeps its id through a reword, a move or a split. A new id is seeded by path and text
  and grows its hex length on a collision; ids are checked against both the map and every marker
  on disk. The canonical form is an uppercase `RL-` and lowercase hex. Embedding is idempotent.
  The editor's text normalising is the one definition of what the hash is computed over, shared
  with the rule-editor wrapper, and a target path that is not a `.md` under the rules tree is
  rejected, since a typo would write a rule no scan ever finds. Files are read once with a
  default instead of an existence check first, which avoids a check-then-read race.
- **The map (`map.ts`, `apply.ts`, `mutate.ts`, `analyzer.ts`, `compile.ts`).** The map is YAML so
  it can be reviewed in a PR, with a stable key order. `apply.ts` is its only writer: it snapshots
  the old map into `.history/`, rewrites the map with a temp file and rename (no lockfile), appends
  to `events.jsonl`, and blesses the new state in the capability lock so a hand edit can be
  detected later. A per-process counter keeps two snapshots in the same millisecond from
  colliding. Mutations are pure and per rule: an added rule becomes a stub entry at once, and an
  edited rule has its scripts cleared, so the reconciler does not report a false added or edited
  rule. Scripts carry over only for rules whose text hash is unchanged, so there is never a global
  rebuild. The rule-file hash is computed after embedding so it matches what is on disk. Compile is
  skipped when the map is present and its rule-file hash still matches, so re-onboarding an
  unchanged tree writes nothing (no new timestamp, snapshot or event).
- **Running scripts (`execute.ts`, `runner.ts`, `enforce.ts`).** A script reads `{ projectRoot,
  files }` on stdin and writes a findings report to stdout, under a timeout. `executeRuleScript`
  (sync, used by the fixture runner) and `executeRuleScriptAsync` (the pool) read the process
  outcome through one interpreter, so a crash, a 30 s timeout or more than 16 MB of output give the
  same `ExecuteResult`; output over 16 MB reads as a timeout in both, as `spawnSync` reports it.
  The pool keeps results in map order whatever order scripts finish in, so with no filter and a
  pool of one the report is byte-identical to the old serial run. Stdout is parsed
  before the exit code is judged, because many linters exit non-zero when they find something;
  valid findings are kept and the exit code or stderr is kept as a diagnostic. Binaries are
  resolved against `PATH` in Node, because `command -v` is a shell builtin and cannot be spawned
  on Linux; a name with a separator is used as is, and on Windows a name that already has an
  executable extension is not given another. The cache key hashes every file any registered
  script can read, so a whole-tree script never serves a stale result after an unrelated change.
  The rule-file hash in the key is the analyze-time one from the map; rule edits surface as drift
  instead. A cache hit still writes a `rule-run.jsonl` row marked `from_cache`, and a cached report
  without results records no findings rather than an empty list that would read as clean.
  Enforcement is independent of `rag_enabled`. `armed` counts registered scripts, because a map
  that arms nothing must read "none armed", not "all clear". At a diff-scoped seam an empty change
  set is skipped instead of scanning the whole tree.
- **Fixtures and the over-flagging guard (`fixture-runner.ts`, `guard.ts`).** A script is never
  registered until it classifies its own pass and fail fixtures correctly. When a declared binary
  is missing the check is deferred, not rejected, because the script never ran. A new script that
  flags too large a share of existing files raises a decision pause, since it is more likely buggy
  than the codebase is broken; deterministic scripts get a tighter threshold than heuristic ones.
- **The header (`header.ts`).** Blank lines and a bare `//` inside the header block are allowed,
  and the parse stops at the first line of code. The key pattern binds the colon straight to the
  capture and the value is trimmed later, which avoids catastrophic backtracking. Id hex and the
  closed-set fields are lowercased so a hand-edited header still validates.
- **Integrity (`integrity.ts`).** The digest only hashes (it never runs a script), so it is safe on
  the per-edit hot path. The map is hashed in its normalised form, so a whitespace reformat is not
  read as tampering, and every referenced script's content (or its absence) is folded in.
- **Drift (`reconciler.ts`, `prune.ts`).** The reconciler is read-only. `drift.json` has two
  writers: the reconciler owns every code except `RS-CONFLICT`, and the analyzer's semantic pass
  owns `RS-CONFLICT`. Each replaces only its own codes and both recompute counts over the union.
  An unreadable `drift.json` is backed up instead of rebuilt, so the other writer's findings are
  not lost. `RS-CACHE-INVALID` is suppressed when an actionable finding fired, since a rule edit
  always changes the hash. Drift being present does not stop the workflow by itself; planning
  reads `escalation.rule_scripts_stale`. Pruning deletes scripts no active rule references, so an
  archived rule's scripts survive one regen cycle; only the `__fixtures__` subtree is removed and
  the stem dir only when it is then empty.
- **`validate.ts`.** The header and findings schemas are validated inside the module, so the
  runtime engine does not depend on the project-artifact validator.

## Why the capability kernel works the way it does

The reasons below are not obvious from the code in `src/kernel/`.

- **`registry.ts`.** The registry is the one versioned list of every governed contract, so a new
  contract is one row and the mode knobs, ledger doc types and schema versions all come from one
  place that a consistency test pins (a `modeKey` must be a registered framework config key). A
  capability id is never renamed, because a bare rename orphans the project's lock and config and
  resets the team's value; a rename needs an alias map. `pre-mutation` exists only on Claude Code
  (the one PreToolUse host); `completion` is every hook-capable host. Narration is honestly
  `unbindable`: chat output has no host seam on any provider, so the kernel records it as emitted,
  never verified. Delivery binds only at completion (no git or CI hooks), so `warn` is its honest
  floor. Decision-pause minting is advisory because the detector is a heuristic; the block lives in
  the gate on an open packet. Rule loading has no mode knob and a `block` floor, because loading the
  rules is not optional.
- **`capability.ts`.** `CAPABILITY_IMPLS` lists only the contracts already moved onto the kernel
  seam. A registry row without an implementation keeps its older path, and a contract is added here
  only when its old path is removed, so nothing fires twice. `evaluate()` returns a no-op for an
  ordinary "nothing to enforce" and lets infra errors propagate, so the hook soft-fails instead of
  wedging the agent. Side-effect narration (stage markers recorded to the ledger) rides on the
  outcome and is shown even when nothing blocks, because a ledger write must never be silent.
  - Rule-compliance floor: an unrecognised value on either team surface is ignored, so a typo never
    weakens the floor.
  - Rule-scripts: when the compat check says this install predates the project's blessed schema,
    the capability declines to enforce rather than misread a newer format, and never blocks. On a
    tampered map enforcement is not run at all; the tamper is the verdict. "No scripts armed" is
    reported as a skipped verdict only at the completion seam, so mid-edit seams do not nag on every
    edit. A Codex `apply_patch` call counts as feature development when any of its paths is, and a
    call with no payload fails closed for code.
  - Stages block-forward: it reads the stage ledger, never a git delta, so a committed clean tree
    cannot nullify it. Before reading the ledger it sweeps the turn transcript for `paqad:stage`
    markers emitted earlier in the same turn and records them with the same idempotent routine the
    Stop hook runs, so the remedy the block message names clears the block in the same turn and is
    never recorded twice. Planning and specification ends must carry a real artifact digest, so a
    bare marker pair or an empty file does not unblock; the block message teaches the `-- <path>`
    form for those stages. The fast lane relaxes only the specification requirement; a path in a
    `sensitivity: high` module floors the lane back to full, and an unknown lane is treated as full.
  - Bundle write guard: it runs ahead of the mode and scope checks (bundle files sit under the
    out-of-scope `.paqad/**`, and the rule is not tunable). The refusal names the verb that owns the
    file from the bundle manifest's `writer` field, so a new bundle file needs no second list; the
    `screenshots/` subtree belongs to the visual-evidence verbs, and a path outside the project is
    never a bundle file. Framework scripts write through `fs`, not a host tool, so they never reach
    this seam; a shell write is caught later by the envelope `content_hash` check.
  - Rules-loaded: presence only, never coverage, so editing a new file mid-change never deadlocks;
    staleness is the completion gate's non-blocking signal. It does nothing at the completion seam
    (the rules-loaded gate owns that), when no feature is open (the stages gate blocks first, so the
    same edit does not get two blocks) and when the project has no compiled rules to load.
  - Delivery: warn only, completion only; the runner is injected so tests are deterministic.
  - Decision pause: both minters only mint, never block (the decision-pause gate blocks the next
    edit). The opt-in self-arm runs first and the spec-change guard runs only when self-arm minted
    nothing, so there is at most one pause per turn.
- **`capability-lock.ts`.** An unreadable lock is treated as no lock. Writing a capability's digest
  merges into the existing lock, so other capabilities' entries and fields written by a newer
  engine survive. Only the engine's single-writer path writes it, never the enforcement seam. The
  blessing also stamps the capability's current policy and record schema versions; a lock written
  before those existed reads as "unversioned".
- **`compat.ts`.** The install's registry versions are the floor this engine knows how to enforce.
  Lock equal to registry is current; lock older is forward compatible and re-blessed on the next
  write; no versions recorded is unversioned and the digest gate still runs. A lock newer than the
  install on either dimension wins and is the only verdict that refuses, because an old install
  cannot be trusted to read a newer schema; the silent update heals the install and the next run is
  current.
- **`gate.ts`.** Any blocking outcome blocks the host (exit 2): stderr carries the blocking findings,
  stdout the advisory ones when nothing blocks. A thrown infra error propagates so the hook
  soft-fails to exit 0, which reads as "could not run", never a false all-clear. The first frontend
  edit visual-evidence reminder is model-facing context only, so any failure on its path degrades
  to no reminder instead of dropping a blocking outcome.

## Tests

- `tests/unit/rule-scripts/enforce.test.ts` — blocks under strict with the rule
  text not loaded; warn surfaces without blocking; clean passes; fast-skip with no
  map and with mode off; summary capping; the pre-edit filter.
- `tests/unit/rule-scripts/runner-golden.test.ts` — the report matches a golden captured from
  the serial runner. `runner-filter.test.ts` — filters, no tree scan, separate reports, pool
  order. `file-cache.test.ts` — the per-file cache. `execute.test.ts` — sync and async parity.
- `tests/unit/kernel/rule-gate-budget.test.ts` — seam filters, the budget, the marker and the
  rollback; `rule-compliance-mode.test.ts` — the options each seam passes.
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
