---
id: "TD-01M5CW8WGAFVSRZ3AHEKD9VMS8"
title: "Rule override rows claim by human but the agent can read the stop token and call the verb"
kind: "gap"
severity: "medium"
status: "open"
files:
  - "src/hud/last-block.ts"
  - "src/rule-scripts/override.ts"
found_in:
  change: "01M5CCWX6FTKY8C6EJKMR9EH3D"
  issue: null
  stage: "review"
found_by: "paqad-review"
session: "d789e5c2-ce91-442b-a379-7e12b94b7dd9"
created_at: "2026-10-20T14:43:28.901Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`paqad-ai rules override` records `by: "human"` for any caller holding the stop token, but the
token is stored in plain text in `.paqad/session/hud/<session>.last-block.json`
(src/hud/last-block.ts:79-99). The agent can read that file through its shell and run the verb
itself, which writes a rule-overrides.jsonl row and a receipt line claiming a person allowed
the edit. The forged row does not change any hook decision (no gate reads rule-overrides.jsonl,
and the gate honours the `allowed_once` mark the verb also writes only on a retry of the same
tool call, which only the HUD makes), so this is an evidence-attribution gap, not a gate bypass.

There is no secret the mod can hold that the agent, running with the same user's rights,
cannot also read. Options: record the row as `by: "hud-card"` with the attestation stated
honestly ("answered through the HUD card; not proof a person pressed it"), move the row write
into the mod process so the CLI verb no longer exists for the agent to call, or deny agent
Read/Bash access to the hud session dir in the pre-tool gates.
