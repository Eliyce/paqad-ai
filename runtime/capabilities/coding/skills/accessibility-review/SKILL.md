---
name: accessibility-review
description: Audit the running UI against WCAG 2.2 A/AA — contrast, focus visibility, keyboard order, ARIA, target size, prefers-reduced-motion. Findings tagged WCAG-2.2.x.x.x.
model_tier: reasoning
triggers:
  - workflow:
      - design-test
      - design-retest
cacheable: false
cache_key_inputs:
  - src/**
  - docs/instructions/design-system/accessibility.md
  - docs/instructions/design-system/tokens.md
output_format: markdown
input_schema:
  source_roots:
    type: path[]
    required: true
    description: Roots to scan for UI source.
  accessibility_path:
    type: path
    required: true
    description: Path to the project's accessibility.md contract clause.
  axe_results_path:
    type: path
    required: false
    description: Path to axe-core results JSON emitted by runtime-checks.ts (live phase).
---

## What It Does

Audits the UI against WCAG 2.2 A/AA. Combines (1) static scan for missing ARIA, missing alt text, and obvious focus issues with (2) axe-core results from the Playwright walk (Step 3 of the workflow). Every finding cites a WCAG 2.2 success criterion id — the design-test analog of WSTG ids in pentest.

## Use This When

Use this for every design-test run. Driven by the live phase's axe-core output when available; static-only when the live phase is blocked.

## Inputs

- Read `docs/instructions/design-system/accessibility.md` for declared a11y rules.
- Read `references/wcag-mapping.md` to map findings to WCAG ids.
- Read the axe-core results JSON from `runtime-checks.ts` if the live phase ran.

## Procedure

1. Static scan for likely violations:
   - `<img>` without `alt`
   - `<button>` with no accessible name (no text, no `aria-label`, no `aria-labelledby`)
   - `<a href>` with no accessible name
   - form controls without `<label>` or `aria-labelledby`
   - missing landmark roles on top-level routes (`<main>`, `<nav>`, `<header>`, `<footer>`)
   - `tabindex` ≥ 1 (positive tabindex breaks keyboard order)
   - `outline: none` / `outline: 0` without a replacement focus ring
2. Consume axe-core violations from `runtime-checks.ts` output. Each axe rule id maps to one or more WCAG criteria (see `references/wcag-mapping.md`).
3. Verify each rule declared in `accessibility.md`: contrast ratio met, focus ring visible, target size ≥ declared minimum, reduced-motion respected, keyboard order matches reading order.
4. Cross-reference with `tokens.md` — contrast violations point at the token pair that's failing (e.g. `color.text.muted` on `color.surface.base` = 3.8:1, below 4.5:1).

## Output Contract

- Match `assets/output.template.md`. `contract_ref` is a WCAG id like `WCAG-2.2-1.4.3` (contrast) or the relevant `accessibility.md` clause.
- Default severity: WCAG Level A violations → **blocker**, Level AA → **high**, design-system-specific rules → **medium**.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when no axe-core results are available AND the static scan found nothing — coverage may be inadequate. Emit a `blocked_checks` entry noting the live phase didn't run.
- Warn when `accessibility.md` is missing — defer to `design-system-coverage` (tier likely `bare`); run as exploratory.

## Resources

- `references/wcag-mapping.md`
- `scripts/lint-findings.sh`
- `assets/output.template.md`
- `agents/openai.yaml`
