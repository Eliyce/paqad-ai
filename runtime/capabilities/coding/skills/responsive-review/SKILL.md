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

Enumeration and gap detection are deterministic — drive them with the scripts.
The LLM picks severity and writes findings.

1. Run `scripts/extract-breakpoints.sh <responsive.md>` → `<name>\t<width-px>` TSV. This is the declared truth.
2. Run `scripts/find-horizontal-scroll.sh <runtime-checks.json>` → one row per `(route, breakpoint)` pair where `horizontalScroll=true`. Each row is a finding candidate.
3. Run `scripts/find-touch-target-violations.sh [--min <px>] [search-root]` → rows for icon-only / tap targets below the declared minimum (default 24px; pass `--min 44` for mobile-first).
4. If `responsive.md` declares RTL support: cross-walk each route with `dir="rtl"`; flag layout breaks (no scripted detector — visual inspection of the RTL screenshot manifest).
5. If a declared breakpoint has zero routes exercising it in the surface walk → `documentation-drift` finding.

## Output Contract

- Match `assets/output.template.md`. `contract_ref` is `responsive.md → breakpoint:<name>` or a WCAG target-size id.
- Severity: horizontal scroll → **high**, touch-target violation → **high** (also cross-link `WCAG-2.2-2.5.8`), RTL break → **medium**, untested breakpoint → **low**.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when `responsive.md` is missing — defer to `design-system-coverage`.
- Warn when surface-walk JSON is unavailable — emit `blocked_checks` and run static-only.

## Resources

- `references/responsive-checklist.md`
- `scripts/extract-breakpoints.sh` — declared breakpoints from `responsive.md`.
- `scripts/find-horizontal-scroll.sh` — horizontal-scroll picks from a runtime-checks payload.
- `scripts/find-touch-target-violations.sh` — sub-minimum tap-target candidates (CSS px + Tailwind `w-N`/`h-N`).
- `scripts/lint-findings.sh`
- `assets/output.template.md`
- `agents/openai.yaml`
