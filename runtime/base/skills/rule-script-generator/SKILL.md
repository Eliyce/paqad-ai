---
name: rule-script-generator
description: Generates one or more deterministic .mjs verification scripts (plus pass/fail fixtures) for each rule classified deterministic or heuristic with no existing enforcer in rule-script-map.yml (issue #89). Every script is validated against its own __fixtures__ before registration — a script that misclassifies its fixtures is rejected and surfaced via the Decision Pause Contract, never added to the map. Strict from generation; there is no shadow mode. The deterministic gate lives in src/rule-scripts/{fixture-runner,header,execute,guard}.ts; this skill is the agent-side wrapper that authors the scripts and invokes the bundled .mjs validators.
model_tier: reasoning
triggers:
  - workflow:
      - rules-generate
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  project_root:
    type: path
    required: false
    description: Project root used to resolve rule-script-map.yml and write scripts. Defaults to cwd.
  only_rule_id:
    type: string
    required: false
    description: When set, regenerate scripts for just this rule (RL-<hash>).
---

## What It Does

For every rule in `rule-script-map.yml` whose `verifiability.kind ∈ {deterministic, heuristic}` and whose `enforced_by` is empty, authors one or more Node ESM scripts under `.paqad/scripts/rules/<mirror>/<rule-file>/NNN-name.mjs`, each with `__fixtures__/pass/` and `__fixtures__/fail/`. Each script:

- Carries the `@paqad-rule-script` header (validated against the header schema).
- Reads `{ projectRoot, files }` from stdin and writes the findings JSON contract to stdout.
- Is validated against its own fixtures **before** registration. Pass fixtures must yield zero findings; fail fixtures at least one. A script that fails is rejected and surfaced — never registered.

No `.sh` scripts are ever produced. See `references/script-authoring.md` for the full contract.

## Use This When

- A user prompt matches the priority-225 router rules `generate rule scripts` or `regenerate scripts for rule RL-<id>`.
- After `analyze rules` has produced a reviewed `rule-script-map.yml`.

## Inputs

- `docs/instructions/rules/rule-script-map.yml` (read for rules + classifications; written only via the bundled `register-script.mjs` → `src/rule-scripts/apply.ts`).
- The rule text for each target rule (to author the detection logic).
- Existing in-scope source files, used for the over-flagging dry-run guard.

## Procedure

1. Load the map. Select target rules: `kind ∈ {deterministic, heuristic}` and `enforced_by == []`. If `only_rule_id` is set, restrict to it.
2. For each target rule, author `NNN-name.mjs` with the header + stdin/stdout contract (`references/script-authoring.md`), plus 2–4 synthetic 5–15 line fixtures under `__fixtures__/pass/` and `__fixtures__/fail/`. Fixtures are synthetic — never copied from the user's real code.
3. Validate the script against its fixtures:
   ```
   node scripts/validate-script.mjs <abs-script-path>
   ```
   Exit 0 = accepted. Exit 1 = rejected: surface a Decision Pause packet ("script `NNN-name.mjs` failed its own fixtures — regenerate / edit / mark unverifiable?") and do **not** register.
4. Over-flag dry-run: run the accepted script across in-scope existing files. If the flag rate exceeds the per-kind threshold (`deterministic: 0.05`, `heuristic: 0.20`), surface a Decision Pause packet before registering.
5. Register the validated script onto its rule:
   ```
   node scripts/register-script.mjs <project-root> <script-path-rel> <rule-id> <kind> <scope>
   ```
6. At the end of the cycle, prune orphaned scripts (left by edited / downgraded / removed rules):
   ```
   node scripts/prune.mjs <project-root>
   ```
   Deletes any `.mjs` + `__fixtures__/` under `.paqad/scripts/rules/` not referenced by an active map rule. Archived rules' scripts survive one cycle, then this prunes them.
7. Present the `## Generation Summary`: scripts accepted, scripts rejected (with reasons), over-flag warnings, pruned files. Tell the user the next prompt (`feature-development` will now enforce them).

## Output Contract

- Accepted scripts written under `.paqad/scripts/rules/...` with their `__fixtures__/`.
- `rule-script-map.yml` updated via `src/rule-scripts/apply.ts` with each accepted script entry (`path`, `kind`, `runtime`, `scope`, `last_validated_at`, `fixtures_passed: true`).
- A `## Generation Summary` markdown block listing accepted / rejected / over-flag, each rejection naming the exact regen prompt.

## Escalate / Stop Conditions

- Never register a script that fails its fixtures or whose header is invalid — surface a Decision Pause packet instead.
- Never author a `.sh` script; Node `.mjs` only.
- Never copy fixtures from the user's real code — fixtures are synthetic.
- Skip rules with non-empty `enforced_by` (already covered) and `unverifiable` rules.
- All map writes go through `register-script.mjs` → `src/rule-scripts/apply.ts`.

## Resources

- `runtime/base/skills/rule-script-generator/references/script-authoring.md` — header + findings + fixtures contract.
- `runtime/base/skills/rule-script-generator/agents/openai.yaml` — agent interface metadata.
- `src/rule-scripts/fixture-runner.ts` — the fixture gate.
- `src/rule-scripts/guard.ts` — the over-flagging guard.
- `src/rule-scripts/prune.ts` — orphan-script pruning (end-of-cycle).
- `.paqad/decision-pause-contract.md` — packet semantics for rejected scripts.
