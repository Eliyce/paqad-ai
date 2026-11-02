---
name: style-enforcer
description: "Normalizes drafts to the project's writing style and formatting rules in docs/instructions/rules/writing-style.md. Use when a draft is ready to publish, as the last pass after content-reviewer and seo-optimizer."
---

# Style Enforcer

## What It Does

Applies the project's writing-style rules (and only those rules) to a draft so style is enforced consistently rather than guessed each time.

## Use This When

As the final pass before publish, after `content-reviewer` and (when applicable) `seo-optimizer` have run.

## Inputs

- The draft.
- `docs/instructions/rules/writing-style.md` (the source of truth: never override with general rules).
- `assets/default-rules.txt` only when the project has no writing-style file.

## Procedure

1. Run `scripts/check-style.sh <draft>`: flags violations of the style file (e.g. forbidden phrases, required cases, Oxford-comma policy).
2. For each flagged line, apply the project rule, never a generic preference.
3. Format the change list per `assets/output.template.md`.

## Output Contract

- Match `assets/output.template.md`: `## Style Edits` (one bullet per change with line number and rule citation).

## Resources

- `references/style-source.md`
- `scripts/check-style.sh`
- `assets/output.template.md`
- `assets/default-rules.txt`
