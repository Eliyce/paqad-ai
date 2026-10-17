---
'paqad-ai': patch
---

Realign the Claude Code hook layer with Claude Code 2.1.228-2.1.302 (#615): resolve the project root from the hook payload's worktree `cwd`, recognise Desktop `[SYSTEM NOTIFICATION - NOT USER INPUT]` banners before routing and ticket intake, keep the prompt hook's output under the host's 10,000-character cap, defer the completion verdict while a `paqad-<stage>` subagent is still running in the background, route slash commands by name instead of as prose, and make the three edit gates fail closed with `onFailure: "block"` and a 10-second timeout. Codex, Gemini and advisory hosts keep their current behavior.
