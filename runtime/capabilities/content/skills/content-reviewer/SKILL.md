---
name: content-reviewer
description: Review drafts for clarity, structure, evidence quality, and reader usefulness against the project's writing rules. Use when a draft needs a structured review pass before publishing.
---

# Content Reviewer

## What It Does

Runs a structured review pass over a draft so feedback is concrete (line + heuristic + required action) instead of subjective.

## Use This When

Use this when a draft is ready for review and the team wants consistent, traceable feedback rather than personal taste.

## Inputs

- The draft markdown / copy.
- The project's writing-style file at `docs/instructions/rules/writing-style.md` when it exists.
- `references/review-rubric.md` for the review heuristics.

## Procedure

1. Run `scripts/scan-prose.sh <draft>` to surface candidate issues (filler, hedge, passive, jargon, vague this, long lines, broken links).
2. For each hit, decide if it's an actual problem given the audience defined by the brief.
3. Walk every heuristic in `references/review-rubric.md`; never skip a category silently.
4. Format findings per `assets/output.template.md`.
5. Validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Blocking Issues` and `## Improvement Opportunities`.
- Output must pass `scripts/lint-output.sh`.

## Resources

- `references/review-rubric.md`
- `scripts/scan-prose.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
