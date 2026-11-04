---
'paqad-ai': minor
---

A background update now tells you what it changed. It leaves a git-ignored record, and the session after the update adds one line asking the agent to tell you. Run `paqad-ai update --last` to see the same summary and notes a manual `update` prints. This line reaches Claude Code and Codex developers only for now. The session that starts the update doesn't hear about it, because the update runs in the background.

`Changed <n> files:` in the `update` summary now counts every file the update changed, not only the regenerated ones.
