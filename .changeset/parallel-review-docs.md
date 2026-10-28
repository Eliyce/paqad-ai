---
'paqad-ai': minor
---

After development, review and documentation sync now run at the same time, and checks runs once on the final tree. On Claude Code the orchestrator dispatches the two agents in one message; on Codex it spawns both and waits on both. A review fix goes through the one development agent after both have returned, documentation sync runs again only when the fix changes what the docs describe, and then checks runs. Hosts without parallel subagents and the fast lane keep review, then documentation sync, then checks. A stage agent's start no longer releases another stage agent's hold, so the turn end keeps waiting for review while documentation sync starts and finishes beside it. Review runs `paqad-ai review digest` again just before it records, so documentation sync's edits are included, and returns blocked when that run fails.
