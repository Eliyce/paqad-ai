---
id: "TD-01M6S055R6KVGPAF3D9WSR5J1G"
title: "decision resolve warns on unknown flags and can lose the reason or the standing answer"
kind: "bug"
severity: "low"
status: "open"
files:
  - "src/cli/program.ts"
found_in:
  change: "01M6RF9KPAM4XSEYPVGBBWZP70"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "8227e3c6-8b8e-4b12-af7a-b6ea0a107fe9"
created_at: "2026-11-06T17:57:56.577Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`decision resolve` accepts unsupported flags with only a warning and exit 0, through the option handling in `src/cli/program.ts`, which this change did not touch.

Reproduced on the branch build:
- `resolve <id> a --rationale=text` drops the text. The stored rationale is empty.
- `resolve <id> a --rationale "two words"` warns that it is ignoring the option, yet stores "two words", because the value falls through as the positional rationale.
- `resolve <id> a --alway` resolves the packet and sets no standing answer.

The stored reason now feeds later judgement, so a lost reason costs more than it did. To fix: refuse unknown flags on this command, or add `--rationale` as a real option.
