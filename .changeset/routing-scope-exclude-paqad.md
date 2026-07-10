---
'paqad-ai': minor
---

Routing: exclude `.paqad/` as well as `docs/` from feature-development. The bootstrap's routing narrative now tells the agent that a change confined entirely to the `docs/` and/or `.paqad/` directories is out of feature-development scope (no planning/spec stages), while a change touching any other directory is feature-development even when it also edits files under `docs/` or `.paqad/`. This matches the enforcement code in `src/stage-evidence/scope.ts`, which already excluded both paths; only the agent-facing narrative was under-describing the scope.
