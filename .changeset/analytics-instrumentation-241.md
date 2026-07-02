---
'paqad-ai': minor
---

Add the complementary analytics-instrumentation agent (#241): an opt-in, coding-first,
provider-detected capability that wires a feature's analytics tracking on top of a correct
build. Ships the `analytics_instrumentation` flag (default off), read-only provider +
convention detection, a classify-time gate carried forward via a sidecar, analytics conflict
categories on the Decision Pause Contract, and a new script-written `paqad.analytics-tag`
ledger on the shared session-ledger substrate — flag-gated recording, script-driven reading
(`paqad-ai analytics show`), the generated `analytics-tracking-map.md` registry
(`analytics map`), cross-provider record seams (Claude PreToolUse + Codex/Gemini completion
markers), and SIEM export inclusion.
