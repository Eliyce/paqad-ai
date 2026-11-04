---
id: "TD-01M6KE5VATB5Q6QQZCDK46X80G"
title: "Team file hashes differ between Windows and Mac line endings"
kind: "bug"
severity: "medium"
status: "open"
files:
  - ".paqad/.gitattributes"
  - "src/git-workflow/last-applied.ts"
found_in:
  change: "01M6K92PZ1DDTQ0Y221RS8QRK3"
  issue: "845"
  stage: "documentation_sync"
found_by: "documentation_sync"
session: "67df04a3-0df1-4746-b345-79c93986dc2e"
created_at: "2026-11-04T14:07:32.159Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`hashText` in `src/git-workflow/last-applied.ts` hashes raw bytes, and `.paqad/.gitattributes` sets no line ending for team files. A Windows checkout with `core.autocrlf=true` hashes differently from a Mac stamp, so all five git-workflow files count as changed outside the skill. Stamping only unlisted files never clears them.

## Fix idea

Hash with CRLF turned into LF, or add an `eol=lf` rule for these files to the managed `.gitattributes` block.
