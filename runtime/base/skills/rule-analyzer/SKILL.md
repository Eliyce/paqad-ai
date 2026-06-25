---
name: rule-analyzer
description: One-shot classifier for rules-as-scripts (issue #89). Reads every rule file under docs/instructions/rules/**, embeds stable RL-<hash> markers, classifies each rule's verifiability (deterministic / heuristic / unverifiable), detects rules already enforced by ESLint/TS/Prettier/existing paqad infra, detects rule conflicts, and writes a draft docs/instructions/rules/rule-script-map.yml for the user to review before `generate rule scripts`. The deterministic mechanics live in src/rule-scripts/; this skill is the agent-side wrapper that invokes the bundled .mjs scripts and routes all writes through src/rule-scripts/apply.ts (the only writer of rule-script-map.yml).
model_tier: medium
triggers:
  - workflow:
      - rules-analyze
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  project_root:
    type: path
    required: false
    description: Project root used to resolve docs/instructions/rules and the map. Defaults to cwd.
---

## What It Does

Turns prose rules into a reviewable contract. For every bullet under `docs/instructions/rules/**` it:

- Embeds an opaque, stable `<!-- @rule RL-<hash> -->` marker (idempotent — reruns cause no churn).
- Classifies verifiability:
  - `deterministic` — a script can decide pass/fail (e.g. "no debugger statements").
  - `heuristic` — a script can flag candidates; humans/LLM adjudicate (e.g. "business logic belongs in hooks").
  - `unverifiable` — with a reason (e.g. "coherence is judgment-dependent").
- Records pre-existing enforcers in `enforced_by` so no duplicate script is generated.
- Detects contradictory rules and surfaces them via the Decision Pause Contract before any script work.

It writes a draft `docs/instructions/rules/rule-script-map.yml`. **The user reviews this map before `generate rule scripts`.**

## Use This When

- A user prompt matches the priority-225 router rule `analyze rules`.
- After adding or editing several rules and you need to re-classify the rule set.
- Before `generate rule scripts` on a fresh project — generation reads this map.

## Inputs

- All markdown rule files under `docs/instructions/rules/**` (the `.yml` registries are not prose rules and are skipped).
- The project's existing enforcers, read to populate `enforced_by`: `eslint.config.js` / `.eslintrc.*`, `tsconfig.json` strictness flags, Prettier config, and existing paqad infra (`module-health`, `design-test`, `pentest`).
- The prior `rule-script-map.yml` if present (script entries are carried over for unchanged rules).

## Procedure

1. Embed markers + collect the inventory:
   ```
   node scripts/analyze.mjs [project-root]
   ```
   Prints `{ inventory, files, rule_files_hash, changed_files }`. The script has already written the markers back into the rule files on disk.
2. Detect existing enforcers per rule. Read `eslint.config.js`/`.eslintrc.*`, `tsconfig.json`, Prettier config. A rule covered by an existing enforcer gets `enforced_by: ["eslint:no-debugger"]` and **no script** — see `references/classification-guide.md`.
3. Classify each remaining rule `deterministic` / `heuristic` / `unverifiable`. Use `references/classification-guide.md` for the decision rubric. `unverifiable` requires a `reason`.
4. Run the conflict pass. For any pair of contradictory rules (e.g. "always named exports" vs "components use default exports"), record them and surface a Decision Pause packet quoting both rules; await resolution before writing the map. Record conflicts into drift.json so the dashboard + planning gate see them:
   ```
   node scripts/record-conflicts.mjs <project-root> <conflicts.json>
   ```
   where `conflicts.json` is `[{ "rule_ids": ["RL-…","RL-…"], "message": "…" }, ...]`. This emits `RS-CONFLICT` findings.
5. Write the draft map through the single writer:
   ```
   node scripts/write-map.mjs <project-root> <classifications.json>
   ```
   where `classifications.json` is `[{ "id", "verifiability": { "kind", "reason"? }, "enforced_by": [] }, ...]`.
6. Present the `## Analysis Summary` block and tell the user to review the map, then type `generate rule scripts`.

## Output Contract

- Every rule bullet under `docs/instructions/rules/**` carries an `<!-- @rule RL-<hash> -->` marker.
- `docs/instructions/rules/rule-script-map.yml` written via `src/rule-scripts/apply.ts` with every rule classified and `enforced_by` populated.
- A `## Analysis Summary` markdown block: counts per verifiability kind, count `enforced_by` (no script needed), and any conflicts surfaced.
- The exact next prompt for the user: **`generate rule scripts`**.

## Escalate / Stop Conditions

- Never write `rule-script-map.yml` directly — all writes go through `node scripts/write-map.mjs` → `src/rule-scripts/apply.ts`.
- Stop and surface a Decision Pause packet for every rule conflict before writing the map; do not silently pick a winner.
- If `docs/instructions/rules/` is absent, stop — there are no rules to analyze.
- Classify a rule `unverifiable` (with reason) rather than inventing a brittle script for inherently fuzzy rules ("match repo conventions").

## Resources

- `runtime/base/skills/rule-analyzer/references/classification-guide.md` — verifiability rubric + enforced-by detection.
- `runtime/base/skills/rule-analyzer/agents/openai.yaml` — agent interface metadata.
- `src/rule-scripts/analyzer.ts` — scan + embed + assemble engine.
- `src/rule-scripts/apply.ts` — atomic single writer of `rule-script-map.yml`.
- the Decision Pause Contract (in the framework bootstrap) — packet semantics for conflicts.
