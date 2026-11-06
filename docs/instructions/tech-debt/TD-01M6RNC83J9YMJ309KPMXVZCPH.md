---
id: "TD-01M6RNC83J9YMJ309KPMXVZCPH"
title: "Option-overlap reuse crosses ratchet kinds, specs and self-arm targets"
kind: "bug"
severity: "high"
status: "open"
files:
  - "src/planning/decision-store.ts"
  - "src/quality-ratchet/exception-decision.ts"
found_in:
  change: "01M6RF9KPAM4XSEYPVGBBWZP70"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "8227e3c6-8b8e-4b12-af7a-b6ea0a107fe9"
created_at: "2026-11-06T14:49:34.034Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

Exists on main, unchanged by the one-click earlier answers change, and out of scope there. The overlap match in `findReusableDecision` compares category and option keys only, and these guards use fixed keys, so one answer applies to every later question in the category.

Reproduced on main with indexed store-shape answers:
- Ratchet: an `approve-exception` for kind-A also approves kind-B through `resolveReusableExceptionKinds`, although the packet text says the approval is reused for the same kind.
- Spec change: `keep-current-spec` for spec-X skips the pause for spec-Y.
- Self-arm: returns `already-decided` for a different target file.

Fix direction: for these callers, reuse on the exact fingerprint only.
