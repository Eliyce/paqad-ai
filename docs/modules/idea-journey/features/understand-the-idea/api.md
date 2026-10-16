# Understand the idea: API

This feature has no network or HTTP API and no script of its own. It is the `understand-idea` step skill, run at step 1 only when the `product-discovery`
journey directs it.

| Item | Value |
|---|---|
| Inputs | The user's description; `setup` and any seed from an answer hand-over |
| Questions | One at a time, each with a recommendation and two or three choices through the host's choice prompt (CON-1, TALK-8); suggested success measures offered the same way (CON-6) |
| Output blocks | `idea` `{goal, who_benefits, success, constraints}`; `assumptions` `[{id, question, default, why}]`; `glossary` `[{user_term, project_term}]` |
| Written by | `product-discovery` through `record.py update` (see [record-lifecycle API](../../../discovery-record/features/record-lifecycle/api.md)) |
| Exit condition | `idea` present and not stale (`record.REQUIRED[1]`) |
