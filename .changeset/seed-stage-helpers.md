---
'paqad-ai': minor
---

Stage helpers on Claude Code now start with a short stage brief instead of re-reading the framework files.

A new SubagentStart hook hands each paqad stage helper its role, its read list and instructions, the change, the lane, the previous pillar files and the exact stage commands, then records its entry check. If the hook is missing or fails, the helper loads the framework the way it did before. Codex is unchanged.

Each stage helper can now run at its own effort and model. Planning, specification and review now default to high effort, checks and documentation sync to low, and development keeps the main session's effort. Every model defaults to inherit. To go back to the old behavior, set these keys to `inherit` in `.paqad/configs/.config.models`: `stage_effort_planning`, `stage_effort_specification`, `stage_effort_review`, `stage_effort_checks` and `stage_effort_documentation_sync`. Run `paqad-ai stage settings` to see the values for this project.
