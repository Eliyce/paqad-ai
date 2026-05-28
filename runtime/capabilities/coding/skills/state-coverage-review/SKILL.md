---
name: state-coverage-review
description: Verify every component in the AST inventory implements its declared states (default/hover/focus/disabled/loading/error/empty) and is exercised by Playwright tests.
model_tier: reasoning
triggers:
  - workflow:
      - design-test
      - design-retest
cacheable: false
cache_key_inputs:
  - src/**
  - docs/instructions/design-system/components.md
  - tests/**
  - e2e/**
output_format: markdown
input_schema:
  source_roots:
    type: path[]
    required: true
    description: Roots to scan for component definitions.
  test_paths:
    type: path[]
    required: false
    description: Playwright test files that exercise component states.
---

## What It Does

Cross-checks the declared state machine of each component against (1) what the source code implements and (2) what Playwright tests actually exercise. A declared state that's neither implemented nor tested is a finding; an implemented state that's never tested is a coverage finding.

## Use This When

Use this for every design-test run after `component-conformance-review`. It depends on the AST inventory that skill produced.

## Inputs

- Read `docs/instructions/design-system/components.md` for declared states.
- Read Playwright test files (`tests/**`, `e2e/**`) for what's exercised.
- Read `references/state-coverage-checklist.md` before grading.

## Procedure

1. For each component in the AST inventory, enumerate declared states from `components.md` (default to `default / hover / focus / disabled / loading / error / empty` if unspecified).
2. Static check: does the source implement each state? (Look for the prop/branch, the `data-state` attribute, the `:hover` / `:focus-visible` / `:disabled` selector, the conditional render for loading/error/empty.)
3. Test check: does at least one Playwright test drive each state on each component? Use `runtime/scripts/design/coverage.sh` output to answer this.
4. Each missing state-implementation pair is a `state` finding. Each tested-but-not-implemented pair is a `documentation-drift` finding (the test asserts something the component can't reach).

## Output Contract

- Match `assets/output.template.md`. `contract_ref` is `components.md → <ComponentName> > <state>`.
- Default severity `medium`. Use `high` when the missing state is `focus` (a11y blocker) or `error` (silently fails for users).
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when Playwright is not configured — coverage cross-check can't run; emit all state findings as `confidence: low`.
- Warn when a component has no declared states in `components.md` — defer the check, emit a `documentation-drift` finding instead.

## Resources

- `references/state-coverage-checklist.md`
- `scripts/lint-findings.sh`
- `assets/output.template.md`
- `agents/openai.yaml`
