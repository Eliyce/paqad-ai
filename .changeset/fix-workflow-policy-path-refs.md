---
"paqad-ai": patch
---

Fix stale documentation references that pointed the workflow-policy files at `.paqad/workflows/` instead of their real home, `docs/instructions/workflows/`. The `rounds:` round-cap override is configured in `docs/instructions/workflows/feature-development.yaml` (`.paqad/workflows/` is the per-run records directory, a different thing). Adds a regression guard so a workflow-policy YAML can never again be referenced under `.paqad/workflows/`.
