# Base-Drift Awareness — Technical View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `base-drift`

## Module Boundaries

- `src/rag/base-drift.ts` — `computeBaseDrift`, `refreshBaseDrift`, `loadBaseDrift`,
  `composeBaseDriftSection`.
- `src/rag/git-state.ts` — F7 base detection (`readGitState`).
- `src/context/rule-context.ts` — `writeRuleContext` appends the `driftSection` last.
- `src/cli/commands/rag.ts` — `rag refresh-context` runs the debounced fetch + injects it.

## Entry Points

- `computeBaseDrift(projectRoot, { baseBranch?, remote?, git? })` → `BaseDriftSnapshot | null`
  from LOCAL refs (`rev-list --count <merge-base>..origin/<base>`); no network.
- `refreshBaseDrift(projectRoot, { baseBranch?, remote?, now?, minIntervalMs?, git? })` →
  `{ refreshed }` — debounced + single-flight, `ls-remote` tip-check, conditional `fetch`,
  persist snapshot. Never throws.
- `loadBaseDrift(projectRoot)` → snapshot | null (best-effort).
- `composeBaseDriftSection(snapshot)` → the heads-up markdown, `''` when no drift.

## Data Model / Schema

- `BaseDriftSnapshot { base_branch, remote_ref, ahead, checked_at }` persisted at
  `.paqad/session/base-drift.json`. Debounce marker `.paqad/session/base-drift.marker`,
  lock `.paqad/locks/base-drift.lock`.

## API / Interface Contract

- **Off the critical path.** Only the detached worker (`rag refresh-context`) calls
  `refreshBaseDrift`; the prompt path reads the persisted snapshot. The fetch is debounced
  to `DEFAULT_BASE_DRIFT_INTERVAL_MS` (10 min, within the 5-15 min band) and single-flighted.
- **No needless network.** An `ls-remote` tip-check compares the remote base tip to the
  local `origin/<base>`; the `fetch` runs only when they differ.
- **Fail-silent.** Any git/network/auth failure returns a reason (`debounced` / `in-flight`
  / `no-base` / `error`) and surfaces no heads-up; never throws, never blocks.
- **Secondary layer.** The drift section is appended LAST in the session-context artifact,
  after rules, memory, and retrieval, and is empty in the common no-drift case.

## State Management

- Writes the snapshot atomically (F1 `atomicWriteFile`); touches the debounce marker before
  the fetch so a crash mid-fetch still floors the next attempt. Reads local git refs.

## Failure Modes

- Non-git dir / no base / no remote-tracking ref → `computeBaseDrift` null, no snapshot.
- Offline / auth failure → tip-check returns nothing, fetch skipped, no heads-up.

## Tests

- `tests/unit/rag/base-drift.test.ts` — `composeBaseDriftSection` (no-drift / singular /
  plural); real-git `computeBaseDrift` (zero drift) and `refreshBaseDrift` (detects 2 new
  remote commits after fetch, persists snapshot); debounce suppresses the second refresh;
  non-git dir is fail-silent; `loadBaseDrift` null when absent.
