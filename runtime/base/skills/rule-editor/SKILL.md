---
name: rule-editor
description: Single entry point for mutating rules in rules-as-scripts (issue #89) — add / edit / remove / downgrade — with a per-rule cascade and no global rebuild. Adding inserts a bullet + mints a stable RL-<hash> id; editing preserves the id and regenerates only that rule's scripts; removing archives the map entry (delayed delete); downgrading flips a rule to unverifiable and drops its scripts. The deterministic file + map mechanics live in src/rule-scripts/{editor,mutate}.ts; this skill orchestrates re-analysis, regeneration, and Decision Pause diffs. All map writes go through src/rule-scripts/apply.ts.
model_tier: medium
triggers:
  - workflow:
      - rules-edit
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  project_root:
    type: path
    required: false
    description: Project root used to resolve rule files and the map. Defaults to cwd.
  mode:
    type: string
    required: false
    description: add | edit | remove | downgrade. Inferred from the user's prompt.
---

## What It Does

Owns the mutation cascade so adding, editing, or removing a rule recomputes only what changed — never a full regeneration:

| Mode      | Effect                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| add       | Inserts the bullet into the target rule file, mints a stable `RL-<hash>` id, then classifies + generates scripts for **only the new rule**.               |
| edit      | Updates the bullet text, **preserves the id**, regenerates only that rule's scripts, and surfaces a behavior diff via Decision Pause when scripts change. |
| remove    | Removes the bullet, moves the map entry to `archived:` (delayed delete); scripts pruned on the next regen pass.                                           |
| downgrade | Keeps the rule, deletes its scripts, flips the map entry to `verifiability.kind: unverifiable` with a recorded reason.                                    |

## Use This When

- A user prompt matches the priority-225 router rules `add rule`, `edit rule`, `remove rule`, or `mark rule as unverifiable`.

## Inputs

- The target rule file (for `add`) or the `RL-<id>` (for edit/remove/downgrade).
- The new rule text (`add`, `edit`) or downgrade reason (`downgrade`).
- `docs/instructions/rules/rule-script-map.yml` (written only via the bundled wrapper → `src/rule-scripts/apply.ts`).

## Procedure

1. Apply the deterministic mechanics:
   ```
   node scripts/edit-rule.mjs add       <project-root> <source-rel> "<text>"
   node scripts/edit-rule.mjs edit      <project-root> RL-<id> "<text>"
   node scripts/edit-rule.mjs remove    <project-root> RL-<id>
   node scripts/edit-rule.mjs downgrade <project-root> RL-<id> "<reason>"
   ```
2. For `add` and `edit`: re-run `analyze rules` (idempotent — touches only the changed rule) then `generate rule scripts` with `only_rule_id` set to the affected id, so only that rule's scripts are regenerated.
3. For `edit`, diff the regenerated scripts against the prior ones; if behavior changed, surface a Decision Pause packet before accepting.
4. Present a `## Rule Change Summary` naming the id, the mode, and any scripts added/removed.

## Output Contract

- The rule markdown updated with a preserved/minted `<!-- @rule RL-<hash> -->` marker.
- `rule-script-map.yml` updated via `src/rule-scripts/apply.ts` (archive on remove, unverifiable on downgrade, script set on add/edit).
- A `## Rule Change Summary` markdown block.

## Escalate / Stop Conditions

- `edit` / `remove` / `downgrade` on an id not found on disk stops with a clear error — never guesses which rule was meant.
- Behavior-changing `edit` regenerations surface a Decision Pause diff before acceptance.
- Never edit `rule-script-map.yml` by hand; the wrapper is the only path.
- A new rule that contradicts an existing one is surfaced as a conflict (via `rule-analyzer`) before its scripts are written.

## Resources

- `runtime/base/skills/rule-editor/references/edit-modes.md` — the four sub-modes + cascade contract.
- `runtime/base/skills/rule-editor/agents/openai.yaml` — agent interface metadata.
- `src/rule-scripts/editor.ts` — markdown add/edit/remove mechanics.
- `src/rule-scripts/mutate.ts` — per-rule map mutations.
- `.paqad/decision-pause-contract.md` — packet semantics for edit diffs + conflicts.
