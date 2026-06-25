---
name: rule-script-reconciler
description: Retrospective drift detector for rules-as-scripts (issue #89). Compares rule-script-map.yml against the rule markdown on disk and the registered scripts, emits RS-* findings into .paqad/scripts/rules/.cache/drift.json, and surfaces user-approvable deltas via the Decision Pause Contract at feature-development planning entry. No LLM judgement — the TS engine is src/rule-scripts/reconciler.ts; this skill is the agent-side wrapper that invokes it and routes resolutions through rule-editor / rule-script-generator.
model_tier: fast
triggers:
  - workflow:
      - feature-development
      - rules-analyze
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  project_root:
    type: path
    required: false
    description: Project root used to resolve rule-script-map.yml and rule files. Defaults to cwd.
---

## What It Does

Detects every form of rules-as-scripts drift and writes `.paqad/scripts/rules/.cache/drift.json`:

| Code               | Meaning                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `RS-RULE-ADDED`    | A markdown bullet without a `<!-- @rule -->` marker, or a marked rule absent from the map — an ungated addition. |
| `RS-RULE-EDITED`   | Marker present, but the text hash differs from the map entry.                                                    |
| `RS-RULE-REMOVED`  | A map entry whose marker is gone from the markdown.                                                              |
| `RS-SCRIPT-STALE`  | A rule was edited but its scripts were not regenerated.                                                          |
| `RS-FIXTURE-FAIL`  | A registered script no longer passes its own fixtures.                                                           |
| `RS-CACHE-INVALID` | The findings report exists but its `rule_files_hash` no longer reconciles.                                       |

Any code except `RS-CACHE-INVALID` blocks `feature-development` per the project's `escalation.rule_scripts_stale` setting.

## Use This When

- At `feature-development` planning entry (the planning stage instructions invoke it).
- During `analyze rules`, to confirm the map is in sync before classifying.

## Inputs

- `docs/instructions/rules/rule-script-map.yml` (read-only).
- The rule markdown under `docs/instructions/rules/**` (read-only — no marker embedding here).
- The registered `.paqad/scripts/rules/**/*.mjs` scripts and their fixtures.
- The cached `.paqad/scripts/rules/.cache/report.json` for the cache-validity check.

## Procedure

1. Run the reconciler:
   ```
   node scripts/reconcile.mjs [project-root]
   ```
   Exit 0 = clean. Exit 1 = drift present (blocking).
2. Group findings by code. For each, surface a Decision Pause packet:
   - `RS-RULE-ADDED` → "Unmarked rule detected — treat as a new rule (run `analyze rules`) or as an edit of an existing rule?"
   - `RS-RULE-EDITED` → "Rule text changed — `edit rule RL-…` (regenerate scripts) or accept as-is?"
   - `RS-RULE-REMOVED` → "Marker gone — `remove rule RL-…`?"
   - `RS-SCRIPT-STALE` / `RS-FIXTURE-FAIL` → "Regenerate scripts for `RL-…`?"
3. Apply the chosen resolution through `rule-editor` or `rule-script-generator`. Never edit the map directly.

## Output Contract

- `.paqad/scripts/rules/.cache/drift.json` written with findings + counts + `blocked`.
- A `## Drift Findings` markdown block listing each code, count, and one-line detail.
- A `## Pending User Decisions` block for each surfaced packet.
- Under `escalation.rule_scripts_stale: stop|ask`, block planning until resolved.

## Escalate / Stop Conditions

- Block `feature-development` planning on any RS-\* drift except `RS-CACHE-INVALID`, per `escalation.rule_scripts_stale`.
- Never embed markers or write the map from this skill — resolutions route through `rule-editor` / `rule-script-generator`.
- `RS-CACHE-INVALID` is informational; the runner recomputes the report on its next run.

## Resources

- `runtime/base/skills/rule-script-reconciler/references/drift-codes.md` — the RS-\* vocabulary + resolution map.
- `runtime/base/skills/rule-script-reconciler/agents/openai.yaml` — agent interface metadata.
- `src/rule-scripts/reconciler.ts` — the drift-detection engine.
- the Decision Pause Contract (in the framework bootstrap) — packet semantics.
