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

## Tests

- `tests/unit/background/atomic-artifact.test.ts` — target absent until swap, parent
  creation, no-target-on-throw, distinct concurrent temps, atomic overwrite, no temp left behind.
