---
name: canonical-doc-sync
description: 'Syncs implementation changes back into canonical documentation. Use when code changes are understood and handoff has not closed, above all when several doc surfaces must change together.'
metadata:
  model_tier: medium
  cacheable: 'true'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Updates canonical project documentation after implementation changes so specs, module docs, and registries remain aligned with the actual behavior that shipped or is about to ship.

## Use This When

After code changes are understood and before handoff closes, especially when multiple doc surfaces must be updated together to avoid drift.

## Inputs

- Read the changed files, existing canonical docs, and any generated inventories for the affected area.
- Read the module docs and global registries that should reflect the change.
- Read `references/drift-triage.md` before deciding what to update immediately versus defer explicitly.

## Procedure

1. Run `scripts/list-canonical-docs.sh` to enumerate the canonical doc surfaces that exist in this project.
2. Identify which of those are now stale relative to the implementation change.
3. Update behavior docs, module docs, and registries together: never patch only one surface.
4. Prefer generated inventories or script output for routes, events, and error codes when available.
5. Format per `assets/output.template.md` and validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Updated Docs` (backticked .md paths + summary) and `## Known Drift` (backticked paths + reason, or the literal `none`).
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when docs disagree with implementation and the product decision is unclear.
- Warn when generated sources are missing and a manual sync would be speculative.
- Do not silently skip a stale canonical doc that is still user-facing or operationally important.

## Resources

- `references/drift-triage.md`
- `scripts/list-canonical-docs.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `runtime/templates/runner-scripts/extract-events.sh.hbs`
- `agents/openai.yaml`
