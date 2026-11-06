---
id: "TD-01M6SM2T7F9809WQHZ4EBGE2A8"
title: "A prompt queued during a running turn lets an older verdict word show in the band"
kind: "bug"
severity: "low"
status: "open"
files:
  - "runtime/claude-plugin/mod/live.ts"
found_in:
  change: "01M6SCTKHRJ3BVTHQY2T3XR3KV"
  issue: "831"
  stage: "review"
found_by: "paqad-review"
session: "950169d2-6a83-4705-9685-3a9e2bc76ca4"
created_at: "2026-11-06T23:46:10.762Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`promptSubmitted` in runtime/claude-plugin/mod/live.ts clears `turnId` for any prompt, including one queued while a turn is really running. Read from the minified 2.1.317 bundle, not measured on a real session: a queued prompt with screening enters `prompt.submit` while the turn runs. Measured on the pure functions: before the change `verdictFromEarlierTurn` held an older verdict back in that window; now it does not, until `turn.complete` or the next `turn.start`.

## Effect

The band can show the earlier verdict word instead of `Working` for the rest of the running turn, only when the change is active, not judged, and no stage is running (runtime/claude-plugin/mod/model.ts:949). `turn.complete` does not read `turnId`, and subagent turns are filtered out by `agentId`. Owner decision D-01M6SJEHGHXF7G68BZVR3Q7H1T covers an id left by a turn that never completed, and does not speak to this case.

## Fix path

The `prompt.submit` argument carries an optional `turnId`. If it names the turn in live state, keep the id. Add a register.test.ts case for a queued prompt.
