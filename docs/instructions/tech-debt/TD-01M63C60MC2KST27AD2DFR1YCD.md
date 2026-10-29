---
id: "TD-01M63C60MC2KST27AD2DFR1YCD"
title: "A live stage agent of another session holds a change with no age bound"
kind: "gap"
severity: "low"
status: "open"
files:
  - "src/feature-evidence/abandon.ts"
  - "src/stage-evidence/stage-agent-holds.ts"
found_in:
  change: "01M636XGSQWPQYWGN1YF9E39HB"
  issue: null
  stage: null
found_by: "paqad-review"
session: "5067f880-9a84-46e8-9d93-614ae3afaabe"
created_at: "2026-10-29T08:24:49.531Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`runningStageOfOtherSession` (src/stage-evidence/stage-agent-holds.ts) returns a live stage agent of another session no matter how old it is. Open stages without an agent are bounded by the 30-minute rule, but agents are not. A `stage-agent started` row with no matching stop row keeps holding the bundle in three cases: the SubagentStop row was lost, the host process is still alive (a long-lived Claude Code host), or `host_pid` is null. While it holds, other sessions on the branch cannot adopt the change, and `closeAbandonedBundles` (which asks with a null session) never closes a confirmed-merged bundle.

Only a `startup`/`resume` SessionStart releases such an agent, and only when its host pid is dead or null. This repo records no started stage-agent rows today (D-01M63A75M60RD91DFA9RZMNQYC), so the gap is latent.

## Options

- Bound the agent hold too, for example by the same 30-minute recency of the agent's session's newest row, or by a longer cap.
- Release a stuck agent after a cap in `closeAbandonedBundles`.
