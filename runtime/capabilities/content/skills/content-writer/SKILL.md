---
name: content-writer
description: Produce reader-ready drafts for docs, briefs, landing pages, and internal writing deliverables, starting from a brief and ending in style-compliant prose. Use when an approved brief needs to become a publishable draft.
---

# Content Writer

## What It Does

Drafts copy from an approved brief, pulling technical context only when the project has coding active, and keeps claims precise and actionable.

## Use This When

Use this after `content-planner` produced a brief and the next step is a draft. Skip when the brief is incomplete (run `content-planner` first).

## Inputs

- The approved brief (typically the output of `content-planner`).
- `docs/instructions/rules/writing-style.md` when present.
- `references/draft-checklist.md`.

## Procedure

1. Confirm the brief passes `content-planner/scripts/lint-brief.sh` before starting.
2. Draft into `assets/draft.template.md` — never start without the audience and goal in mind.
3. Run `scripts/check-coverage.sh <brief> <draft>` to confirm every brief outline section appears in the draft.
4. Run `scripts/word-count.sh <draft>` to confirm length aligns with the brief's constraints.
5. Hand off to `content-reviewer` for the structural review pass.

## Output Contract

- Match `assets/draft.template.md` headings.
- Coverage check (`scripts/check-coverage.sh`) must pass before review.

## Resources

- `references/draft-checklist.md`
- `scripts/check-coverage.sh`
- `scripts/word-count.sh`
- `assets/draft.template.md`
