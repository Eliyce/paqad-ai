---
name: permission-boundary-review
description: 'Reviews authorization, tenant isolation and privileged route boundaries. Use when docs or route inventories describe privileged actions, admin surfaces, policy checks or tenant-specific data.'
metadata:
  model_tier: reasoning
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Reviews permission, authorization, and tenant-boundary expectations so pentest findings can focus on real access-control gaps instead of generic auth reminders.

## Use This When

When module docs or route inventories describe privileged actions, admin surfaces, policy checks, or tenant-specific data handling.

## Inputs

- Read the module docs that describe privileged flows first.
- Read `references/boundary-checklist.md` before deciding whether evidence is sufficient.
- Read tests and route evidence that show how the project enforces those boundaries.

## Procedure

1. Run `scripts/scan-authz-smells.sh` to surface candidate IDOR / hidden-admin / impersonation / broad-export / cross-tenant patterns.
2. For each hit, walk the relevant module docs to determine whether code, tests, or runtime evidence proves the boundary.
3. Bucket each finding into an area from `assets/area-rubric.txt` (idor, privilege-escalation, tenant-isolation, hidden-admin, impersonation, broad-export).
4. Treat doc-vs-implementation disagreement as a security finding, never a benign inconsistency.
5. Format per `assets/output.template.md`; validate with `scripts/lint-findings.sh`.

## Output Contract

- Match `assets/output.template.md`: severity, WSTG-AUTHZ id, area from `assets/area-rubric.txt`, Evidence, Missing proof, Required action.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when the privilege model is unclear or not described anywhere in the project.
- Warn when runtime evidence suggests a privileged path is exposed without clear protection.
- Do not mark a boundary as safe purely because authentication exists.

## Resources

- `references/boundary-checklist.md`
- `scripts/scan-authz-smells.sh`
- `scripts/lint-findings.sh`
- `assets/output.template.md`
- `assets/area-rubric.txt`
- `agents/openai.yaml`
