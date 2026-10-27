# Turn an answer into an idea: API

This feature has no network or HTTP API and no script. It is part of the `ask-project` skill: when
an answer shows a real problem or opportunity, one short line offers to shape a change, after the
Sources line and the source line, through the choice prompt when the host has one (TALK-13).

| Item | Value |
|---|---|
| Trigger | The user accepts the offer |
| Output | A seed for the `idea` and `today` record blocks (shapes in `skills/product-discovery/assets/record-template.md`); `today` entries carry the answer's source paths |
| Written by | `product-discovery` through `record.py update` once the journey starts (see [record-lifecycle API](../../../discovery-record/features/record-lifecycle/api.md)); `ask-project` does not import `record.py` |
