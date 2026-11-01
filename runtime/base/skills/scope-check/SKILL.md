---
name: scope-check
description: Validate that requested work stays inside the active spec boundary.
metadata:
  model_tier: fast
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Checks whether the requested change is already authorized by the active spec so implementation does not drift into unspecced work.

## Use This When

Use this before implementation, refactors, or bug fixes that could quietly expand scope beyond the approved story or solution artifact.

## Inputs

- Read the request text at `request_text`.
- Read every active spec artifact passed in `spec_paths`.
- Read `references/scope-rules.md` before deciding whether the request is covered, additive, or out of scope.

## Procedure

1. Run `scripts/check-spec-presence.sh` — exit 1 means immediately classify as `blocked-no-spec` and stop.
2. Extract requested behavior change, modules, and constraints from the request.
3. Compare against the active spec artifacts only (no inferred memory, no informal context).
4. Pick a decision from `assets/decision-vocabulary.txt` (`within-scope | extension-needed | blocked-no-spec`).
5. Cite exact spec evidence (file + criterion/passage).
6. Format per `assets/output.template.md`; validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Scope Decision` (decision token + one-line justification), `## Spec Evidence`, `## Required Next Step`.
- Decision token must come from `assets/decision-vocabulary.txt`.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Block when no spec artifact exists for feature, bug-fix, refactor, or migration work.
- Ask when multiple spec artifacts conflict or define incompatible boundaries.
- Do not grant scope based on an unstated workflow or informal memory.

## Resources

- `references/scope-rules.md`
- `scripts/check-spec-presence.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/decision-vocabulary.txt`
- `.paqad/`
- `agents/openai.yaml`
