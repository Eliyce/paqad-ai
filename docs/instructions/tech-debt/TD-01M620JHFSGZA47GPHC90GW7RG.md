---
id: "TD-01M620JHFSGZA47GPHC90GW7RG"
title: "The allowed_once mark and the outcome line are local state the agent can write directly"
kind: "gap"
severity: "low"
status: "open"
files:
  - "docs/modules/feature-evidence/features/rule-override/technical.md"
  - "src/hud/last-block.ts"
  - "src/kernel/gate.ts"
  - "src/rule-scripts/override.ts"
found_in:
  change: "01M61XDEFF9BAS6V560PT6PMK4"
  issue: "765"
  stage: "review"
found_by: "paqad-review"
session: "c08524c9-ca32-4dff-8570-cedfa2eac427"
created_at: "2026-10-28T19:42:42.655Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

The `allowed_once` mark the gate reads (src/hud/last-block.ts `takeAllowedOnce`, src/kernel/gate.ts `allowedOnce`) and the outcome line (`paqad-ai rules override --outcome`, src/rule-scripts/override.ts `recordEditOutcome`) are plain local state that the agent, running as the same user, can write itself.

- Mark: the gate answers `ask` for any call whose `tool_use_id`, rule and file match a record with `allowed_once: true`. The agent cannot predict a new `tool_use_id`, but a background shell process that tails the session transcript could see a new Edit's id and write a matching record into `.paqad/session/hud/<session>.last-block.json` before the PreToolUse gate runs. The result is an `ask` instead of a deny: in default/auto modes Claude Code's dialog still decides (with a reason that wrongly says the person allowed it in the HUD); in `bypassPermissions` the ask runs with no dialog.
- Outcome: `--outcome` needs no token, only an override line for the `tool_use_id` with no outcome yet. A process racing the HUD between the override line and the HUD's own outcome run could write `landed` first, and the HUD's true outcome is then refused as a duplicate.

The docs (rule-override/technical.md "Forged override rows") and TD-01M5CW8WGAFVSRZ3AHEKD9VMS8 describe only the verb path and say a forged row "cannot let an edit through". That holds for the verb, not for a direct write of the record.

Found reviewing #765. Not a loosening of Claude Code's own answer: the worst case is paqad's own gate asking instead of denying.

## Options

- Deny agent Bash/Write access to `.paqad/session/hud/` in the pre-tool gates (same option as TD-01M5CW8WGAFVSRZ3AHEKD9VMS8).
- Bind the mark to the token with an HMAC keyed from a file the mod writes outside the project, or have the mod pass the token through the retry rather than a file flag.
- Require the stop token (or the mark's consumption) for `--outcome`, or let the latest outcome from the HUD win.
- Reword the docs paragraph to name the direct-write path.
