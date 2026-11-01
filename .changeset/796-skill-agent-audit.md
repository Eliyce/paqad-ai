---
'paqad-ai': minor
---

Audit paqad's own skills and agents against the skill and agent lints. `paqad-ai skill lint --all` and `paqad-ai agent lint --all` lint the whole project into one deterministic JSON report (`--report`, `--group-by rule|folder`, `--as-of`), list persona files apart, and lint the stage-agent templates after rendering them. `paqad-ai skill audit` renders `docs/instructions/tech-debt/skill-agent-audit.md` with a kept Before section and a rewritten After section. paqad's custom skill keys move under `metadata`, with JSON-shaped values in a sibling `skill.meta.yaml`; skills that still carry the old top-level keys keep working through a parser fallback that is removed in 1.117.0, and each such skill records one deprecation line.
