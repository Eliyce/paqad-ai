---
id: "TD-01M6K2SQ8YXSY6T3FT9K3KX7BJ"
title: "Session line proofs skip silently if the build entry is dropped"
kind: "gap"
severity: "low"
status: "open"
files:
  - "tests/unit/hooks/last-update-session-start.test.ts"
  - "tsup.config.ts"
found_in:
  change: "01M6JW1PAC0MRPEFDFXYVC56MX"
  issue: "840"
  stage: "review"
found_by: "review"
session: "f5433cfe-6124-45e1-b2f9-d7cda76f2141"
created_at: "2026-11-04T10:48:40.453Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

The positive session line proofs in `tests/unit/hooks/last-update-session-start.test.ts` run under `describe.skipIf(!HAS_ENTRY)`, where `HAS_ENTRY` checks for `dist/update/last-update.js`. CI builds before the test shards, so they run on all three systems today.

If the `update/last-update` entry left `tsup.config.ts`, these tests would skip with no failure, the older-dist test would still pass, and the session line would silently stop in the published package because the hook swallows the import failure. The spec's tarball check is manual.

## Fix idea

Add one assertion that `tsup.config.ts` names the entry, as `tests/unit/hooks/stage-agent-start.test.ts` does for its own hook.
