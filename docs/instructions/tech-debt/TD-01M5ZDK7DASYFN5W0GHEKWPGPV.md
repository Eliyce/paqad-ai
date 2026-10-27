---
id: "TD-01M5ZDK7DASYFN5W0GHEKWPGPV"
title: "RAG file discovery recompiles a minimatch per file and pattern, ~300 s CPU per refresh"
kind: "follow-up"
severity: "high"
status: "open"
files:
  - "src/rag/file-filter.ts"
found_in:
  change: "01M5YZPHCJ89TVAMWFJYS19CJ0"
  issue: "756"
  stage: "documentation_sync"
found_by: "paqad-development"
session: "924099c9-ba6b-48aa-8fc2-867026e90f4d"
created_at: "2026-10-27T19:32:33.308Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

A CPU profile of one `rag refresh-context` on this repo (warm index, no changed files, after the sync-once change) spent 306 s of 323 s in file discovery: `discoverFiles` -> `evaluateFile` -> `evaluateLayer3` -> `matchesProjectGlob` (src/rag/file-filter.ts). `matchesProjectGlob` calls `path.matchesGlob` for every file and every candidate pattern, and each call compiles a fresh minimatch (regExpEscape, parse, toRegExpSource dominate self time). Compiling each project glob once per discovery (or caching compiled matchers by pattern) should cut a refresh from about 5 minutes of CPU to seconds.

Measured with /usr/bin/time: before the sync-once change 603.7 s user + 22.9 s sys; after 303.5 s user + 11.3 s sys (50.2% of before). Nearly all of the remainder is this glob compilation.
