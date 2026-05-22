# Constitution

## Purpose

Define the non-negotiable operating rules for the framework.

## Rules

- Work docs-first before writing code.
- If `docs/modules/` is absent, run `create documentation` before any feature work begins. Do not skip this even if the user requests a feature directly.
- Prefer deterministic scripts and MCP over file scanning.
- Preserve user-owned project files unless explicitly updating them.
- Never read files outside the active project-profile module list unless the user or canonical docs require it.
- Never start implementation work before a spec artifact exists in `.paqad/` for that change.
- Prefer MCP tool results over file scanning when both are available and trustworthy.
- If classification confidence is below 80%, escalate instead of guessing.
