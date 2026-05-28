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

1. Static scan for `transition:`, `animation:`, `@keyframes`, framer-motion props, GSAP timelines. Each duration / easing literal is a candidate.
2. For each duration literal:
   - Does it map to a `motion.duration.*` token? If not → `motion` finding.
   - Is it above the declared duration ceiling (typically 400ms for UI motion)? → `motion` finding.
3. For each easing literal: must be one of the declared `motion.easing.*` curves.
4. Reduced-motion check: every animation must be wrapped in a `@media (prefers-reduced-motion: reduce)` guard, OR use a framer-motion `useReducedMotion` hook, OR the animation must be sub-150ms.
5. Cross-check with live phase: did the reduced-motion walk produce identical screenshots to the static walk for animated components?

## Output Contract

- Match `assets/output.template.md`. `contract_ref` is `motion.md → duration` / `motion.md → easing` / `motion.md → reduced-motion`.
- Severity: ignored `prefers-reduced-motion` → **high** (accessibility), over-budget duration → **medium**, ad-hoc easing → **low**.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when `motion.md` is missing.

## Resources

- `references/motion-checklist.md`
- `scripts/lint-findings.sh`
- `assets/output.template.md`
- `agents/openai.yaml`
