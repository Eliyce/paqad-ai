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

Detection and mapping are deterministic — the LLM picks severity and writes
findings; the scripts do the spotting.

1. Static scan: run `scripts/static-a11y-scan.sh [search-root]` → TSV of `<category>\t<file>:<line>\t<excerpt>`. Categories: `img-no-alt | button-no-name | anchor-no-name | input-no-label | outline-zero | positive-tabindex | missing-lang`.
2. Live axe results: when the Step 3 runtime walk produced an axe JSON, run `scripts/parse-axe-violations.sh <axe-results.json>` → TSV of `<route>\t<rule-id>\t<impact>\t<target>\t<help>`. Accepts either a full runtime-checks payload or a bare violations array.
3. For each axe rule emitted, run `scripts/map-axe-to-wcag.sh <rule-id>` to get its primary WCAG 2.2 success criterion id. Unmapped rules return `WCAG-UNKNOWN`; map those manually using the published axe docs.
4. Verify each rule declared in `accessibility.md`: contrast ratio met, focus ring visible, target size ≥ declared minimum, reduced-motion respected, keyboard order matches reading order.
5. Cross-reference with `tokens.md` — contrast violations point at the token pair that's failing (e.g. `color.text.muted` on `color.surface.base` = 3.8:1, below 4.5:1).

## Output Contract

- Match `assets/output.template.md`. `contract_ref` is a WCAG id like `WCAG-2.2-1.4.3` (contrast) or the relevant `accessibility.md` clause.
- Default severity: WCAG Level A violations → **blocker**, Level AA → **high**, design-system-specific rules → **medium**.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when no axe-core results are available AND the static scan found nothing — coverage may be inadequate. Emit a `blocked_checks` entry noting the live phase didn't run.
- Warn when `accessibility.md` is missing — defer to `design-system-coverage` (tier likely `bare`); run as exploratory.

## Resources

- `references/wcag-mapping.md`
- `scripts/static-a11y-scan.sh` — static-only a11y violation candidates (img/button/anchor/input/tabindex/outline/lang).
- `scripts/parse-axe-violations.sh` — flatten axe-core JSON into `(route, rule, impact, target)` rows.
- `scripts/map-axe-to-wcag.sh` — table lookup from axe rule id to WCAG 2.2 success criterion.
- `scripts/lint-findings.sh`
- `assets/output.template.md`
- `agents/openai.yaml`
