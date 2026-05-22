---
name: seo-optimizer
description: Revise drafts for search visibility — keyword placement, heading hierarchy, meta fields, internal links — without sacrificing readability. Use after the draft is reader-ready and before publishing.
---

# SEO Optimizer

## What It Does

Audits a near-final draft for SEO essentials and emits a checklist of concrete edits, never aesthetic suggestions. Preserves the writer's voice.

## Use This When

Use this after `content-reviewer` has passed the draft and the destination supports search-driven traffic.

## Inputs

- The near-final draft.
- The target keyword set (primary + secondary).
- `references/seo-checklist.md`.

## Procedure

1. Run `scripts/audit-seo.sh <draft> <primary-kw>` to get heading depth, title-tag length, meta-description length, primary-keyword occurrences, and image-alt coverage.
2. Walk `references/seo-checklist.md` against the audit output.
3. Format edits per `assets/output.template.md`.
4. Validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## SEO Findings` (each with field/issue/fix) and `## Suggested Title/Meta`.

## Resources

- `references/seo-checklist.md`
- `scripts/audit-seo.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
