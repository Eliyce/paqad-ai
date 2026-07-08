---
'paqad-ai': minor
---

Arm the rule-scripts gate by generating the rule-script map at onboarding (#319).
paqad's deterministic, no-LLM rule enforcement engine was live but disarmed on every
fresh project: `rule-script-map.yml` — the map linking rules to their compiled
scripts — was produced by no code path, so the enforcement seam fast-skipped on the
missing map and the gate passed by default. And the strictness a team set in
`feature-development.yaml` (`checks.rule_compliance.mode`) was read from a different
surface at runtime (`.config`, default `warn`), so a team asking for `strict` silently
got `warn`.

New `paqad-ai rules compile` verb (and `compileRuleScripts`) generates the map from
the rule tree — embedding stable rule ids and listing every rule via the existing
analyzer + atomic-writer, carrying over any bound scripts — and the onboarding
orchestrator now runs it after the rule refresh, so a fresh project is armed. The
strictness resolver now folds the project's on-disk `feature-development.yaml`
`rule_compliance.mode` as a real, team-tracked floor (stricter of it and `.config`
wins; local/env may only raise), and the policy merge no longer silently drops
`rule_compliance` when a project supplies its own workflow file. No enforcement or
atomic-apply logic is reimplemented.
