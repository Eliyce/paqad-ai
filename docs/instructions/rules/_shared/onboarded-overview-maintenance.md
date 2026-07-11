# Onboarded-Project Overview Maintenance

Keep the whole-system map honest when the framework's shape changes. These always load. Specific to this repo (paqad-ai).

<!-- trigger: ** -->

- [`docs/modules/onboarded-project-overview.md`](../../../modules/onboarded-project-overview.md) is the canonical map of how the framework behaves inside an onboarded project. Keep it accurate whenever the _shape_ of the system changes, not for every implementation detail. <!-- @rule RL-3377 -->
- Update it in the same change that adds, removes, or renames a stage in `docs/instructions/workflows/feature-development.yaml`; adds, removes, or renames a skill under `runtime/**/skills/` or an agent under `runtime/**/agents/`; changes which capability gates a skill or agent; or adds or changes a whole-codebase engine (module-map, traceability, cross-module-impact-scanner, RAG/context, verification gates, decision-pause, evidence ledger). <!-- @rule RL-7f9d -->
- Keep it a map, not a copy: point to the authoritative code and per-module docs rather than restating them, so it cannot drift into duplicating implementation. <!-- @rule RL-3220 -->
- `docs/instructions/rules/module-map.yml` remains the single source of truth for module slugs and source paths. When the overview and the module-map disagree, fix the overview. <!-- @rule RL-73e3 -->
