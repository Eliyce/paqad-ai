---
id: "TD-01M5ZK3JKYQXJ6FG914FGRDVCH"
title: "Spec pipeline experts synthesis opens a decision packet for every merge conflict, even compatible claims, with no way for the chief to drop one"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "src/spec-pipeline/experts/conflicts.ts"
  - "src/spec-pipeline/experts/synthesis.ts"
found_in:
  change: "01M5YZPHCJ89TVAMWFJYS19CJ0"
  issue: "756"
  stage: "documentation_sync"
found_by: "paqad-review"
session: "924099c9-ba6b-48aa-8fc2-867026e90f4d"
created_at: "2026-10-27T21:08:51.951Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`paqad-ai spec pipeline experts synthesis` opens a decision packet for every merge conflict between
expert claims, even when the claims are compatible (one adds detail to the other, or they cover
different parts of the same requirement). In change 01M5YZPHCJ89TVAMWFJYS19CJ0 it produced 8 packets
(D-01M5Z1R56Z6J83B976BXV9KDPQ through D-01M5Z1R5729FXPF6F8SAW7ZT6M) that the owner resolved as
adopt-all. The chief has no way to mark a conflict as compatible and drop the packet, so every one
reaches the owner as a question.

## Expected

Synthesis classifies a conflict as compatible (merge both) or real (needs the owner). Only real
conflicts open a packet. The chief can drop a non-conflict with a recorded reason, and the drop is
written to the trace so it can be audited.
