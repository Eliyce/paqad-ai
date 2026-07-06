---
'paqad-ai': patch
---

Fix the Claude Stop hook so it respects the paqad enable/disable flag and can no longer wedge a session in an infinite loop.

- **Respects ON/OFF from the real project root.** `verification-completion.mjs` now resolves the project root via `CLAUDE_PROJECT_DIR` / `PAQAD_PROJECT_ROOT` (cwd fallback) like the sibling Stop hooks, instead of raw `process.cwd()`. A project set to `paqad_enable=false` is honored even when the host launched the hook from a subdirectory (previously the disable flag was missed and the OFF project was still blocked).
- **Bites once, never loops.** Every blocking Stop hook now reads Claude's `stop_hook_active`: the gate still blocks (exit 2) on the first stop so the model gets a turn to fix it, but once it is already inside a Stop-hook continuation it steps aside (surfaces the summary, exits 0). An unresolvable verdict can no longer drive an infinite Stop loop. The git/CI backstop remains the hard, non-bypassable layer.
