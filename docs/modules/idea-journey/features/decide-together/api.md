# Settle open choices: API

This feature has no network or HTTP API and no script of its own. It is the `decide-together` step skill, run at step 4 only when the `product-discovery`
journey directs it.

| Item | Value |
|---|---|
| Inputs | Record blocks `playback`, `assumptions` and the open choices left by shaping |
| Questions | One choice at a time, a recommendation and two or three options through the host's choice prompt (CON-1, TALK-8); the chosen outcome confirmed the same way |
| Output blocks | `decisions` `[{id, question, choice, by, why}]` (ids D1, D2); `assumptions` `[{id, question, default, why}]` (ids A1, A2); `outcome` `{type, reason, next_action}` |
| Written by | `product-discovery` through `record.py update` (see [record-lifecycle API](../../../discovery-record/features/record-lifecycle/api.md)) |
| Exit condition | `decisions` and `outcome` present and not stale (`record.REQUIRED[4]`) |
