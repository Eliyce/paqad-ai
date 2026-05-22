---
name: content-planner
description: Shape a writing task into an outline, brief, sequence, or publishable plan. Use when a content request needs structure (audience, goal, outline, success metric) before drafting.
---

# Content Planner

## What It Does

Turns a broad content ask into a concrete brief that a writer can act on without re-asking the original requester for context.

## Use This When

Use this whenever the next step would be drafting and the request lacks audience, goal, structure, or success metric.

## Inputs

- The original request and any linked references.
- `references/planner-checklist.md` for which fields a brief must contain.

## Procedure

1. Walk `references/planner-checklist.md` (audience, goal, constraints, outline, dependencies, success metric); never skip a field silently.
2. Fill `assets/brief.template.md` with project-specific values; mark unknowns explicitly.
3. Validate with `scripts/lint-brief.sh` — exit 0 means every required field is present.

## Output Contract

- Match `assets/brief.template.md` exactly.
- Output must pass `scripts/lint-brief.sh`.

## Resources

- `references/planner-checklist.md`
- `scripts/lint-brief.sh`
- `assets/brief.template.md`
