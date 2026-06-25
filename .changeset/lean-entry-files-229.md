---
'paqad-ai': minor
---

Lean entry files: load the framework and contracts only when paqad is enabled (#229)

Provider entry files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, and the rest) are now lean stubs. Each one points to a new core-owned framework bootstrap and carries the graceful-degradation fallback clause, nothing more. The load order, the narration contract, and the Decision Pause Contract moved out of every project's `.paqad/` and into that bootstrap (`AGENT-BOOTSTRAP.md`, shipped inside the install), behind a first-instruction enablement check.

What this changes for you:

- A disabled project now loads zero `docs/instructions` and zero `docs/modules` on every provider, because the always-injected entry file no longer carries any load order. An enabled project is unchanged: full framework and docs load exactly as before, including the Claude Code decision tray and the `create documentation` workflow.
- The two managed contract files (`.paqad/decision-pause-contract.md`, `.paqad/narration-contract.md`) are no longer written into projects. `onboard` and `refresh --providers` prune any stale copy left by an older version. Existing projects pick up the lean entry stubs on their next update or refresh.
- The dashboard editor for the Decision Pause Contract is retired (the file is framework-owned now); the approvals inbox that resolves pending decisions is unchanged.

Default stays on. Flipping `paqad_enable` back to true re-enables everything with no re-onboard.
