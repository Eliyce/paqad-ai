---
'paqad-ai': minor
---

paqad now asks the owner once per change. When expert claims fit together, the chief architect rules them compatible and writes one merged claim instead of turning them into a question, and the same disagreement is never asked twice. Planning no longer stops to ask which module a change belongs to: a confident choice (score 0.5 or more) is applied and shown to you as a choice you can change, and an unsure one waits for the spec questions step through a new `defer` escalation. The module attribution, the fix proof method and the visual-evidence readiness question all join one round at that step, listed by the new `paqad-ai spec pipeline round`, asked up to 4 at a time. A pending question now holds up only its own change, so other changes keep moving. A project that sets `attribution_pending: stop` keeps the old behaviour.
