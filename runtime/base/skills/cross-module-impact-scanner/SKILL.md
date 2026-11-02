---
name: cross-module-impact-scanner
description: "Classifies how a proposed change affects each consuming module's public surface and recommends coordinated changes. Use when a graduated or full lane change touches a public API, event, shared table, shared config value or re-exported utility."
metadata:
  model_tier: reasoning
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Reads a proposed implementation outline before any code is written and predicts which other modules will be affected. For every public surface the change touches (API contract, event, schema, configuration, shared utility) classifies the impact on every consuming module and recommends the coordinated changes those consumers will need.

The point is to surface contract breakage in design phase, not after a deploy fails.

## Use This When

In the graduated and full lanes whenever the proposed change touches at least one item that crosses module boundaries: a public API, a published or consumed event, a shared database table, a shared configuration value, or a re-exported utility. Skip when the change is purely internal to one module and the integration docs confirm no consumers exist.

## Inputs

- Read the proposed solution at `proposed_solution_path` first.
- Read the module map at `module_map_path` to learn the canonical module slugs.
- Read integration docs and API docs for each module the change references; these are the source of truth for consumer relationships.
- Read `references/impact-classification.md` before classifying any impact so the severity rubric stays consistent.

## Procedure

1. Run `scripts/list-modules.sh` to load canonical module slugs from the module map.
2. Run `scripts/find-integration-docs.sh` to enumerate per-module events/contracts/integration docs.
3. Enumerate every public surface the proposed solution changes (API, event, schema, config, shared utility).
4. For each (surface, consumer) pair, classify severity using `assets/severity-rubric.txt` (`breaking | silent-shift | additive | internal-only`). Default to `breaking` when in doubt; downgrade to `silent-shift` when an `additive` claim has no doc update.
5. For `breaking` / `silent-shift` impacts with no deprecation window, add a Decision Packet entry (category from `assets/severity-rubric.txt` examples).
6. Format per `assets/output.template.md`; validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Cross-Module Impact` + `### Impact Map` table (canonical 5-column header) + `### Decision Packets Required` (when any breaking/silent-shift) + `### Open Questions`.
- Severity values must come from `assets/severity-rubric.txt`.
- Internal-only short circuit: emit `Cross-Module Impact: internal-only, no consumers affected.` exactly, on its own line.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when integration docs and API docs disagree on consumer relationships: resolve via the module map before classifying.
- Warn when the proposed solution implies a surface change but the canonical integration doc is missing or out of date.
- Recommend a Decision Packet whenever a `breaking` impact has no feasible deprecation window.
- Do not classify a change as `additive` when documentation has not been updated to declare the new behavior, downgrade to `silent-shift`.

## Resources

- `references/impact-classification.md`
- `scripts/list-modules.sh`
- `scripts/find-integration-docs.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/severity-rubric.txt`
- `agents/openai.yaml`
