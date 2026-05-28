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

The set arithmetic across declared / implemented / tested is deterministic — drive
it with the scripts. LLM picks severity per missing state (focus and error are
elevated to **high** per the checklist).

1. For each component, run `scripts/extract-source-states.sh <component-file>` → TSV of `<state>\t<signal>` (signals: `:hover`, Tailwind `hover:` utility, `disabled` prop, `aria-disabled`, framer-motion hooks, etc.). `default` is always emitted.
2. Run `scripts/extract-tested-states.sh --component <Name> --tests <dir>` → TSV of `<state>\t<test-file>`. The tests directory should contain Playwright specs only (the script greps for component name + state driver pattern; mixing the component's source with the tests dir would self-pollute the result).
3. Take the declared states from `components.md` (the CSV from `parse-components-md.sh` works directly).
4. Run `scripts/cross-reference-states.sh --declared <csv> --implemented <impl.tsv> --tested <tested.tsv>`. Each row is a deterministic gap:
   - `declared-not-implemented\t<state>` → `state` finding.
   - `implemented-not-tested\t<state>` → `state` finding (regression risk).
   - `tested-not-implemented\t<state>` → `documentation-drift` finding (test asserts something the component can't reach).

## Output Contract

- Match `assets/output.template.md`. `contract_ref` is `components.md → <ComponentName> > <state>`.
- Default severity `medium`. Use `high` when the missing state is `focus` (a11y blocker) or `error` (silently fails for users).
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when Playwright is not configured — coverage cross-check can't run; emit all state findings as `confidence: low`.
- Warn when a component has no declared states in `components.md` — defer the check, emit a `documentation-drift` finding instead.

## Resources

- `references/state-coverage-checklist.md`
- `scripts/extract-source-states.sh` — implemented-states detector for one component file.
- `scripts/extract-tested-states.sh` — tested-states detector across a Playwright tests dir.
- `scripts/cross-reference-states.sh` — declared/implemented/tested set-difference gap emitter.
- `scripts/lint-findings.sh`
- `assets/output.template.md`
- `agents/openai.yaml`
