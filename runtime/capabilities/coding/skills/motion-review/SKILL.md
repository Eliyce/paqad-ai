---
name: motion-review
description: Verify animations match motion.md budgets and prefers-reduced-motion is respected.
model_tier: medium
triggers:
  - workflow:
      - design-test
      - design-retest
cacheable: false
cache_key_inputs:
  - src/**
  - docs/instructions/design-system/motion.md
output_format: markdown
input_schema:
  source_roots:
    type: path[]
    required: true
    description: Roots to scan for animation/transition definitions.
  motion_path:
    type: path
    required: true
    description: Path to motion.md contract clause.
---

## What It Does

Audits the project's motion against `motion.md`: declared duration ceiling, easing curve set, reduced-motion behavior. Catches transitions that exceed the duration budget, ad-hoc easing curves not in the declared set, and components that ignore `prefers-reduced-motion`.

## Use This When

Use for every design-test run after `responsive-review`.

## Inputs

- Read `docs/instructions/design-system/motion.md`.
- Read `references/motion-checklist.md`.
- Read the live phase's reduced-motion screenshot results from `runtime-checks.ts` if available.

## Procedure

Scan and budget parsing are deterministic — drive them with the scripts.

1. Run `scripts/parse-motion-budget.sh <motion.md>` → key/value rows: `duration-ceiling`, `easing`, `reduced-motion`. This is the declared budget.
2. Run `scripts/scan-animations.sh [search-root]` → `<file>:<line>\t<duration-ms>\t<excerpt>` rows. Every duration is normalized to milliseconds (`300ms`, `0.5s` → `500ms`, framer-motion `duration: 0.3` → `300ms`).
3. Compare each emitted ms value to the declared duration ceiling. Over budget → `motion` finding, **medium** by default.
4. Run `scripts/find-reduced-motion-violations.sh [search-root]` → one row per file that animates without `prefers-reduced-motion` or `useReducedMotion()`. Each row is a **high** severity finding (a11y blocker).
5. Cross-check with the live phase: did the reduced-motion walk produce identical screenshots to the static walk for animated components?

## Output Contract

- Match `assets/output.template.md`. `contract_ref` is `motion.md → duration` / `motion.md → easing` / `motion.md → reduced-motion`.
- Severity: ignored `prefers-reduced-motion` → **high** (accessibility), over-budget duration → **medium**, ad-hoc easing → **low**.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when `motion.md` is missing.

## Resources

- `references/motion-checklist.md`
- `scripts/parse-motion-budget.sh` — declared budget from `motion.md`.
- `scripts/scan-animations.sh` — every animation declaration in source, duration normalized to ms.
- `scripts/find-reduced-motion-violations.sh` — files that animate without a reduced-motion guard.
- `scripts/lint-findings.sh`
- `assets/output.template.md`
- `agents/openai.yaml`
