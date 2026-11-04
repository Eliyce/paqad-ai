---
id: "TD-01M6K2SQNZH1PSX1ZTSNPAHKEF"
title: "Tracked Gemini settings hold one developer's home path"
kind: "bug"
severity: "low"
status: "open"
files:
  - ".gemini/settings.json"
found_in:
  change: "01M6JW1PAC0MRPEFDFXYVC56MX"
  issue: "840"
  stage: "review"
found_by: "review"
session: "f5433cfe-6124-45e1-b2f9-d7cda76f2141"
created_at: "2026-11-04T10:48:40.869Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`.gemini/settings.json` is tracked in this repo and line 8 holds one developer's absolute home path for `verification-record.mjs`. Any `paqad-ai update` under another home folder rewrites the file, so it shows as modified for every other developer and counts as a changed file in the update report.

## Evidence

Running update in a clean clone with a separate home changed only this file. The last commit touching it is well before this change. The change's repo update commit correctly left it out, so no temporary path was committed.

## Fix idea

Stop tracking the file here or write a path that doesn't depend on the home folder, keeping the hook rules for explicit interpreters and absolute paths in mind.
