# Branch-Aware Index — Technical View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `branch-aware-index`

## Module Boundaries

- `src/rag/git-state.ts` — `readGitState`, `GitState`, `GitStateOptions`.
- `src/rag/types.ts` — `RagIndexMeta` branch fields.
- `src/rag/vector-index.ts` — `FileVectorIndex.replaceAll` stamps the state.

## Entry Points

- `readGitState(projectRoot, { baseBranch? })` → `{ branch?, head_commit?,
  base_branch?, base_commit? }`.
- `FileVectorIndex.replaceAll(projectRoot, items, metaInput, baseBranch?)` —
  stamps the state into the persisted `RagIndexMeta`.

## Data Model / Schema

`RagIndexMeta` gains optional `branch`, `base_branch`, `base_commit`,
`head_commit` (additive, backward compatible — a pre-F7 index simply lacks them).

## API / Interface Contract

`readGitState` runs four read-only `execFileSync('git', …)` queries:

1. `rev-parse --is-inside-work-tree` — the cheap non-git gate (returns `{}`).
2. `symbolic-ref --short --quiet HEAD` — branch (undefined on detached HEAD).
3. `rev-parse HEAD` — head commit.
4. base branch = first of (`baseBranch` if given), `main`, `master` that resolves
   via `rev-parse --verify`; `merge-base HEAD <base>` → base commit.

Each query is wrapped so a failure yields `undefined`, never a throw.

## State Management

- Stateless reader. The only persisted state is the four fields in
  `.paqad/vectors/meta.json`, written atomically with the rest of the meta.

## Failure Modes

- Non-git dir → `{}` (all fields undefined).
- Detached HEAD → `branch` undefined, others still resolve.
- No base branch present → `base_branch` / `base_commit` undefined.

## Tests

- `tests/unit/rag/git-state.test.ts` — branch/head/base/merge-base on a feature
  branch; master auto-detect; explicit base override; non-git degrade; no-base
  case.
- `tests/unit/rag/vector-index.test.ts` — `replaceAll` stamps the fields inside a
  git repo and leaves them undefined outside one.
