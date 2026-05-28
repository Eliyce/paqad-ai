---
name: responsive-review
description: Verify declared breakpoints are exercised, no horizontal scroll appears, touch targets meet spec, and RTL parity holds when declared.
model_tier: medium
triggers:
  - workflow:
      - design-test
      - design-retest
cacheable: false
cache_key_inputs:
  - src/**
  - docs/instructions/design-system/responsive.md
output_format: markdown
input_schema:
  source_roots:
    type: path[]
    required: true
    description: Roots to scan for UI source.
  responsive_path:
    type: path
    required: true
    description: Path to responsive.md contract clause.
  surface_walk_results:
    type: path
    required: false
    description: JSON of route screenshots × breakpoints from runtime-checks.ts.
---

## What It Does

Verifies the running UI at every declared breakpoint. Catches horizontal scroll, touch targets below the declared minimum, RTL parity gaps, and breakpoints declared in `responsive.md` that no route actually exercises.

## Use This When

Use for every design-test run. Driven by the surface walk's screenshot manifest from `runtime-checks.ts` (Step 3).

## Inputs

- Read `docs/instructions/design-system/responsive.md` for declared breakpoints and rules.
- Read the surface-walk JSON from `runtime-checks.ts`.
- Read `references/responsive-checklist.md`.

## Procedure

1. Enumerate declared breakpoints from `responsive.md` (e.g. `sm: 640`, `md: 768`, `lg: 1024`, `xl: 1280`).
2. For each route × breakpoint screenshot, check:
   - Document scroll width ≤ viewport width (no horizontal scroll).
   - Touch targets ≥ declared minimum (typically 24×24 or 44×44 CSS pixels).
   - Content max-width respected.
3. If `responsive.md` declares RTL support: cross-walk each route with `dir="rtl"`; flag layout breaks.
4. If a declared breakpoint has zero routes exercising it (e.g. `xl` but the walk only goes to `lg`) → `documentation-drift` finding.

## Output Contract

- Match `assets/output.template.md`. `contract_ref` is `responsive.md → breakpoint:<name>` or a WCAG target-size id.
- Severity: horizontal scroll → **high**, touch-target violation → **high** (also cross-link `WCAG-2.2-2.5.8`), RTL break → **medium**, untested breakpoint → **low**.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when `responsive.md` is missing — defer to `design-system-coverage`.
- Warn when surface-walk JSON is unavailable — emit `blocked_checks` and run static-only.

## Resources

- `references/responsive-checklist.md`
- `scripts/lint-findings.sh`
- `assets/output.template.md`
- `agents/openai.yaml`
