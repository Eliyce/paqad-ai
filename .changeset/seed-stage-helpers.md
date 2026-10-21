---
'paqad-ai': minor
---

Stage helpers on Claude Code now start with a short stage brief instead of re-reading the framework files.

A new SubagentStart hook hands each paqad stage helper its role, its read list and instructions, the change, the lane, the previous pillar files and the exact stage commands, then records its entry check. If the hook is missing or fails, the helper loads the framework the way it did before. Codex is unchanged.

Each stage helper can now run at its own effort and model. Planning, specification and review now default to high effort, checks and documentation sync to low, and development keeps the main session's effort. Every model defaults to inherit. Set any of them in `.paqad/configs/.config.models`: `stage_effort_<stage>` and `stage_model_<stage>`. The helper files are shared by every project, so they always keep these defaults, and a project value reaches a helper through `paqad-ai stage settings`, which prints JSON giving each stage its `effort`, its `model` and a `pass` string that says what the main session passes on that stage call. To run a stage at the main session's effort again, set its key to `inherit`; because its helper file still carries the default, the `pass` string then tells the main session to pass its own current effort level on that call. Each stage helper's record now notes the `requested_effort` and `requested_model`, which are what the project asked for, not a reading of what the helper ran at.
