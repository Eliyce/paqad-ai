# Atomic Artifact Swap — Business View

> Module: **Background-Worker Harness** (`background-harness`) · Layer: `framework-internals` · Feature slug: `atomic-artifact-swap`

## Overview

The canonical "build-to-temp then atomic swap" primitive. A worker builds an
artifact to a unique temp path and a single `rename` swaps it into place, so a
reader on the prompt path only ever sees a complete previous artifact or a
complete new one — never a half-written file, even if the worker is killed
mid-build.

The technical contract lives at [`technical.md`](./technical.md).

## User Roles

- **paqad-ai contributor** — writes any background-maintained artifact (rules
  manifest, vector index, codebase memory) through this primitive.

## User Flows

- **Build and swap:** `buildAndSwap(targetPath, build)` runs `build(tempPath)`,
  then renames the temp into `targetPath`.
- **Write bytes:** `atomicWriteFile(targetPath, content)` for the "I already have
  the bytes" case.

## Business Rules

- The target never exists in a partial state; the swap is the only moment it changes.
- Parent directories of the target are created as needed.
- Concurrent builds get distinct temp paths (pid + per-process counter) so they
  cannot collide even if a stale worker races a reclaimed one.
- A failed build produces no target (the swap never runs).

## Triggers & Side Effects

- Writes a temp file next to the target, then renames it over the target.

## Error States

- If `build` throws, the error propagates and the target is left untouched; a
  leftover temp file is harmless and overwritten on the next successful build.

## Glossary

- *atomic swap* — replacing a file via `rename`, which is atomic on a single filesystem.
