---
id: "TD-01M63C618EQBXCTPSNZZZ2FKFX"
title: "Temp-root test helper copied across test files"
kind: "debt"
severity: "low"
status: "open"
files:
  - "tests/unit/feature-evidence/feature-record-wiring.test.ts"
  - "tests/unit/feature-evidence/stage-ledger.test.ts"
found_in:
  change: "01M636XGSQWPQYWGN1YF9E39HB"
  issue: null
  stage: null
found_by: "paqad-review"
session: "5067f880-9a84-46e8-9d93-614ae3afaabe"
created_at: "2026-10-29T08:24:50.172Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The duplication detector flags `tests/unit/feature-evidence/stage-ledger.test.ts:33-40` as 100% similar to `tests/unit/feature-evidence/feature-record-wiring.test.ts:14-21`. Both have the same `roots` / `tempRoot()` / `afterEach(rmSync…)` temp-directory block. This block was already there before this change, which only moved it 4 lines down by reformatting an import. The same block is defined locally in about 66 test files.

## Fix

Add a shared `useTempRoots(prefix)` helper under tests/shared (it registers the afterEach cleanup and returns `tempRoot`). Move test files to it gradually.
