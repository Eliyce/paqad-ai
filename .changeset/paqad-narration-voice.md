---
'paqad-ai': minor
---

Give paqad a visible voice in the live agent chat. Onboarding now bakes a "paqad in your chat" narration contract into every provider entry file (CLAUDE.md, AGENTS.md, .cursor/rules, and the rest), instructing the agent to surface paqad's orchestration work — classification, lane routing, verification verdicts, decision pauses — in a lean, first-person, value-anchored voice. The glyphs (🟢🔴🟡⚪), verdict words, status-block frame, and plain-English term translations are defined once in a canonical voice spec and reused by the PR evidence comment, the dashboard, and the chat contract, plus a managed `.paqad/narration-contract.md` reference doc. A health check flags a missing or drifted contract.
