---
name: session-resume
description: 'Rebuilds compact session context from the canonical handoff artifacts. Use when a context compaction just happened, or when a resumed session needs the lane, stack, warnings and key references.'
metadata:
  model_tier: fast
  cacheable: 'true'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Rebuilds the minimum viable working context after compaction by reading the preserved handoff and the canonical project identity artifacts instead of rescanning `.paqad/` manually.

## Use This When

Immediately after a context compaction or when a resumed session needs the current lane, stack, warnings, and key references without spending tokens rediscovering them.

## Inputs

- Read the preserved handoff at `handoff_path`.
- Read the canonical project metadata at `onboarding_manifest_path` and `project_profile_path`.
- Read `references/resume-template.md` before composing the reconstructed state.

## Procedure

1. Run `scripts/load-resume-bundle.sh`: it reads handoff.md, project-profile.yaml, and onboarding-manifest.json into one stream, exit 1 when any is missing.
2. Reconcile any conflict between handoff and project metadata; preserve uncertainty explicitly rather than picking arbitrarily.
3. Surface only facts needed to safely continue work: phase, objective, blockers, canonical references.
4. Format per `assets/output.template.md`; validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Session State`, `## Project Context`, `## Resume Targets`.
- Resume Targets must list backticked file paths only: no inferred next steps.
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when any required handoff or project metadata file is missing.
- Warn when the handoff conflicts with the stored project profile or onboarding manifest.
- Do not infer new workstreams beyond what the handoff and canonical metadata already establish.

## Resources

- `references/resume-template.md`
- `scripts/load-resume-bundle.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `.paqad/session/handoff.md`
- `agents/openai.yaml`
