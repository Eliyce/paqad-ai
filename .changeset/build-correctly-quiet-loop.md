---
'paqad-ai': minor
---

feat: bounded, quiet build-check-fix loop — wrap the single verification pass in lane-scaled rounds with futility detection, keep the round record internal, and emit exactly one honest "stuck" report via the `stop` escalation at the cap (#108)
