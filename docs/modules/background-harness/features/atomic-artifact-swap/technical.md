# Atomic Artifact Swap — Technical View

> Module: **Background-Worker Harness** (`background-harness`) · Layer: `framework-internals` · Feature slug: `atomic-artifact-swap`

## Module Boundaries

- `src/background/atomic-artifact.ts` — `buildAndSwap`, `atomicWriteFile`.

## Entry Points

- `buildAndSwap(targetPath, build: (tempPath) => Promise<void>): Promise<void>`
- `atomicWriteFile(targetPath, content): Promise<void>` — convenience wrapper.

## Data Model / Schema

Temp path shape: `${targetPath}.tmp.${pid}.${seq}` where `seq` is a monotonic
per-process counter, guaranteeing distinct temp names across concurrent builds.

## API / Interface Contract

1. `mkdir(dirname(targetPath), { recursive: true })`.
2. `build(tempPath)` — the caller fully writes the temp file.
3. `rename(tempPath, targetPath)` — the atomic swap.

`atomicWriteFile` is `buildAndSwap` with a `writeFile(tempPath, content)` build.

## State Management

- Stateless apart from the in-process temp-sequence counter.
- Atomicity relies on `rename` being atomic within one filesystem; temp and
  target are siblings, so this holds.

## Failure Modes

- `build` throws → error propagates, no rename, target untouched; a leftover temp
  is harmless (overwritten next run). Temp cleanup on failure is intentionally not
  attempted to keep the primitive minimal.

## Related Code

- The harness's existing peers re-derive this pattern locally (`src/rag/vector-index.ts`,
  `src/core/schema-version.ts`, others). New background-maintained artifacts should
  route through `buildAndSwap` rather than adding another copy.

## Rename retry on Windows

On Windows, a rename onto a target that another writer or reader is touching at that moment
can fail with `EPERM`, `EACCES` or `EBUSY` instead of replacing it. macOS and Linux do not fail
that way. `src/core/fs/atomic-rename.ts` holds the shared last step for temp-then-rename
writers:

- `renameWithRetry(from, to)` and `renameWithRetrySync(from, to)` try the rename up to
  `RENAME_MAX_ATTEMPTS` (5) times, waiting 10, 20, 40 and 80 ms between tries.
- They retry only on win32 and only for those three codes. Any other error, or any error on
  another platform, is thrown at once.
- When they give up they remove the temp file, so a failed write leaves nothing next to the
  target. The rename error is the one the caller sees.

These writers use it: the HUD files (`src/hud/files.ts`), the site-map progress store, the
checks report store, decision authoring, the feature record, the feature report writer,
`rules-loaded.json` and the spec-pipeline run store. `buildAndSwap` itself still does a plain
`rename`.

## Tests

- `tests/unit/background/atomic-artifact.test.ts` — target absent until swap, parent
  creation, no-target-on-throw, distinct concurrent temps, atomic overwrite, no temp left behind.
