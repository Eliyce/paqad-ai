---
name: token-conformance-review
description: Detect hard-coded design values (hex, raw px/rem, ad-hoc font stacks) in UI source that should resolve to a declared token. High severity by default.
model_tier: reasoning
triggers:
  - workflow:
      - design-test
      - design-retest
cacheable: false
cache_key_inputs:
  - src/**
  - docs/instructions/design-system/tokens.md
output_format: markdown
input_schema:
  source_roots:
    type: path[]
    required: true
    description: Roots to scan for UI source — typically `src/`, `app/`, or `graph-ui/src/`.
  tokens_path:
    type: path
    required: true
    description: Path to the project's tokens.md contract clause.
---

## What It Does

Scans UI source for **hard-coded design values that should resolve back to a declared token**: hex literals, raw `px`/`rem`/`em`, unregistered color names, ad-hoc font stacks, magic shadow values. The presence of `color.primary.500` in `tokens.md` while a component inlines `#1a73e8` is a finding, not a stylistic preference.

`token` findings default to **high severity** — this is the load-bearing check for "is the design system actually being followed."

## Use This When

Use this for every design-test run. It is one of the two primary "is the contract followed" skills, alongside `component-conformance-review`.

## Inputs

- Read `docs/instructions/design-system/tokens.md` to know what's declared.
- Read the contract-summary from `design-system-coverage` (lists every declared token name).
- Read `references/token-leak-checklist.md` before scanning.
- Read `tailwind.config.*` if present — Tailwind theme entries count as tokens too.

## Procedure

1. Run `scripts/scan-tokens.sh` to grep the source roots for hard-coded value patterns. Each hit is an investigation candidate.
2. For each hit, decide:
   - Does a token exist in `tokens.md` (or Tailwind theme) that this literal _should_ resolve to? → `token` finding, **high** severity.
   - Is this a category not yet declared in `tokens.md`? → `documentation-drift` finding pointing at the gap in the contract.
   - Is this in a test fixture, story, or known exemption path? → skip (the scanner excludes `**/*.test.*`, `**/*.stories.*`, `**/__tests__/**`).
3. For each finding, emit `Required action:` with the _concrete fix_: which file, which line, which token to use. Example: `replace #1a73e8 at Button.tsx:42 with color.primary.500 from tokens.md`.

## Categories of Hard-Coded Values

- **Color literals**: `#RRGGBB`, `#RGB`, `rgb(...)`, `rgba(...)`, `hsl(...)` outside of token definitions.
- **Raw spacing**: `padding: 16px`, `margin: 1.25rem`, `gap: 24px` not referencing a `spacing.*` token.
- **Raw radii**: `border-radius: 8px` not referencing `radius.*`.
- **Raw shadows**: `box-shadow: 0 2px 4px rgba(0,0,0,0.1)` not referencing `shadow.*`.
- **Ad-hoc font stacks**: `font-family: 'Helvetica Neue', ...` outside the declared `font.family.*`.
- **Raw font sizes**: `font-size: 14px` not referencing `font.size.*`.
- **Tailwind class bypass**: `className="bg-[#1a73e8]"` (arbitrary value bracket) when a theme color exists.
- **Inline `style=` with values**: every prop value goes through token-conformance.

## Output Contract

- Match `assets/output.template.md`: `## Findings` heading, one bullet per finding with severity, `contract_ref` (clause in `tokens.md`), `Evidence: file:line`, and `Required action:` with the concrete token to use.
- Default severity is `high`. Use `blocker` only when the literal directly contradicts a declared token namespace (e.g. inlining a color when `color.primary` exists). Use `medium` only when the category isn't declared in `tokens.md` yet (which also produces a parallel `documentation-drift` finding).
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when `tokens.md` is missing or all-empty — defer to `design-system-coverage` to gate the workflow.
- Warn when the project uses CSS-in-JS without a declared theme provider — token resolution can't be verified without it.
- Do not downgrade severity to compensate for an incomplete contract; emit a parallel `documentation-drift` finding instead.

## Resources

- `references/token-leak-checklist.md`
- `scripts/scan-tokens.sh` — pre-investigation grep over the codebase
- `scripts/lint-findings.sh` — enforces `contract_ref` + `Evidence: file:line` per finding
- `assets/output.template.md`
- `agents/openai.yaml`
