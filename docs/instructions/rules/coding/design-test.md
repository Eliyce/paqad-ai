# Design-Test Workflow

## Purpose

Audit the running UI against the project's own design-system contract. Mirror of the pentest workflow — same shape, same resumability, but graded against `docs/instructions/design-system/*` instead of OWASP WSTG. The contract is the standard; the framework holds no hard-coded color/spacing rules.

## Trigger

Run this workflow whenever the user says anything equivalent to:

- "run design test", "design check", "design audit", "ui audit", "design-system audit", "check design system", "validate the ui", "validate design" <!-- @rule RL-35ce -->

Do **not** improvise a design audit. Always follow the steps below in order. For a retest of an existing report, use the `design-retest` workflow instead.

## Source-of-Truth Model

| Source                              | Role                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| Playwright walk of the running app  | **primary evidence**                                                               |
| UI source AST + CSS scan            | **primary evidence**                                                               |
| `docs/instructions/design-system/*` | **contract** — what reality is graded against                                      |
| `docs/modules/*/ui/**`              | **subject under audit** — never trusted as evidence; cross-checked against reality |
| Playwright test files               | **coverage evidence** — what's tested ≠ what exists; gap = finding                 |

Docs are help, not truth. Any disagreement between docs and reality produces a `documentation-drift` finding with bidirectional resolution ("either implement the state or remove the claim").

## Workflow Steps

Progress is tracked in `.paqad/design-test/runs/<run_id>/progress.json` (same shape as pentest). The workflow is resumable: if a step is already marked `completed` with the same input hash, skip it.

### Step 0 — readiness-gate

Grade `docs/instructions/design-system/` before any other step runs. The `design-system-coverage` skill produces the tier; it is always the first skill and gates everything else (analog of `stride-threat-model`).

| Tier         | Criteria                                                                    | Behavior                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Missing**  | Directory absent, or all six contract files empty                           | **Stop.** Decision-pause packet via `AskUserQuestion`: "Run `create documentation` for the design system first?" Offers inline invocation of `documentation-update` workflow, then resume.               |
| **Bare**     | Tokens partial; no component inventory; no a11y matrix                      | Warn + prompt. Run in exploratory mode, findings flagged `confidence: low`. Also emit `DT-DS-XXXX` findings listing gaps in the contract itself.                                                         |
| **Adequate** | Tokens + components + a11y + at least one of {patterns, motion, responsive} | Proceed with normal scoring.                                                                                                                                                                             |
| **Strong**   | All six contract files populated                                            | Proceed; if `design_test.strict: true` is set in `project-profile.yaml`, DT-blocker findings gate the dev workflow. Strict mode never auto-engages — explicit opt-in only. |

### Step 1 — collect-context

- Load `docs/instructions/design-system/**` → the contract. <!-- @rule RL-4fd3 -->
- Derive component inventory from **AST scan of `src/components/**`** + Storybook stories if present. **Do not derive from `docs/modules/\*/ui/**`** — instead audit those docs against the derived inventory. <!-- @rule RL-5d67 -->
- Load UI source: theme/style files, Tailwind config (`tailwind.config.*`), design-token sources (`src/design-tokens/`), CSS modules / CSS-in-JS. <!-- @rule RL-76bd -->
- Load Playwright tests as coverage evidence. <!-- @rule RL-ecfe -->
- Emit `contract-summary.json`, `surface-summary.json`, `test-summary.json` to `.paqad/design-test/runs/<run_id>/artifacts/`. <!-- @rule RL-6bcf -->

Skills run **in this order** (`design-system-coverage` gates everything else, like STRIDE):

1. `design-system-coverage` — already ran in Step 0; readiness inventory reused as input to every downstream skill
2. `token-conformance-review` — scan UI source for hard-coded values that should reference tokens. **High severity by default** — hex literals, raw `px`/`rem`/`em`, font stacks not in `tokens.md`, color names not registered as tokens. The presence of a `primary` token while a component inlines `#1a73e8` is a finding, not a stylistic preference.
3. `component-conformance-review` — every used component must be in `components.md`; `!important`, inline `style=`, shadcn primitives wrapped without spec, undocumented Tailwind utility combinations → findings
4. `state-coverage-review` — every component in the AST-derived inventory must implement its declared states (default/hover/focus/disabled/loading/error/empty) AND be exercised by Playwright
5. `accessibility-review` — WCAG 2.2 A/AA: contrast, focus visibility, keyboard order, ARIA, target size, prefers-reduced-motion. Findings tagged `WCAG-2.2.x.x.x` (analog of WSTG)
6. `responsive-review` — declared breakpoints exercised; no horizontal scroll; touch targets ≥ spec
7. `motion-review` — animations match `motion.md`; `prefers-reduced-motion` respected
8. `copy-and-ia-review` — voice/tone/labeling consistency vs `patterns.md`

### Step 2 — run-project-scripts

Five scripts, run in parallel, **shipped inside paqad-ai** (not seeded into the project — see "Footprint policy" below):

1. `runtime/scripts/design/scan-tokens.sh` — AST/grep for hard-coded design values
2. `runtime/scripts/design/scan-overrides.sh` — `!important`, inline `style=`, undocumented Tailwind class combos
3. `runtime/scripts/design/enumerate-surface.sh` — screen/route inventory (Next `app/` / `pages/` / framework router)
4. `runtime/scripts/design/axe-static.sh` — `axe-core` against component snapshots without booting the app
5. `runtime/scripts/design/coverage.sh` — Playwright tests cross-referenced against the AST-derived component inventory

Artefacts → `.paqad/design-test/runs/<run_id>/artifacts/`.

### Step 2.5 — generate-local-design-playbook

For each suspected finding category, emit `docs/design-test/<timestamp>-local-playbook.md` with a Playwright snippet per category — same "break locally first" pattern pentest uses with curl. **Templates only, never auto-executed.** Categories: contrast probe, focus-ring probe, motion respect, touch-target probe, token-leak probe.

Example playbook entries:

```ts
// contrast probe — assert text/bg pair meets WCAG-2.2-1.4.3 (4.5:1)
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('contrast on /pricing', async ({ page }) => {
  await page.goto('/pricing');
  const results = await new AxeBuilder({ page }).withTags(['wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
});

// focus-ring probe — keyboard reach must produce a visible focus outline
test('focus ring visible on primary button', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const outline = await page
    .locator(':focus-visible')
    .evaluate((el) => getComputedStyle(el).outlineWidth);
  expect(outline).not.toBe('0px');
});

// token-leak probe — computed color must resolve to a declared token
test('button bg = color.primary.500', async ({ page }) => {
  await page.goto('/');
  const bg = await page
    .locator('button.primary')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(26, 115, 232)'); // declared in tokens.md as color.primary.500
});
```

### Step 3 — live-validation (Playwright phase)

Equivalent of pentest's live-validation step. The runner brings up the app via `design_test.dev_command` (from the `design_test` block in `project-profile.yaml`) and walks it. It **reuses the project's `playwright.config.ts`** (browsers, projects, baseURL) — overridable through the `design_test` config block.

- **Surface walk** — visit every route from the inventory; screenshot at declared breakpoints <!-- @rule RL-3d12 -->
- **Token diff** — inspect computed styles (color, font-family, font-size, line-height, radius, spacing, shadow) at each route; diff against `tokens.md`. One finding per mismatched property. This is the padding/margin/font/color/border check, mechanized. <!-- @rule RL-e872 -->
- **State sweep** — for every component in the inventory, drive its declared states via Playwright <!-- @rule RL-6b2c -->
- **A11y dynamic** — `@axe-core/playwright` against each route in default + dark-mode + reduced-motion + RTL (if declared) <!-- @rule RL-bf14 -->
- **Visual regression** — first run creates a baseline in `.paqad/design-test/baselines/` (git-ignored); subsequent runs diff; `paqad design accept-baseline` action promotes approved diffs to a tracked path <!-- @rule RL-b19e -->
- **Asset budget** — fonts loaded match `tokens.md`; no extra families <!-- @rule RL-4980 -->
- **Performance budget** — LCP / CLS / INP vs declared budgets (only if `patterns.md` has a perf budget) <!-- @rule RL-976e -->

If the app can't be reached → record `blocked_checks` and proceed (identical to pentest behavior).

Skills consulted in this step: `accessibility-review`, `responsive-review`, `motion-review`, `state-coverage-review` (all keyed to the live walk's evidence).

### Step 4 — synthesize-findings

Reuse `finding-normalizer`; the DT category vocabulary lives in its `assets/vocabulary.txt`. Stable `DT-XXXX` IDs. Each finding:

- `severity`: blocker / high / medium / low / nit <!-- @rule RL-1c1d -->
- `category`: token / component / state / a11y / responsive / motion / copy / performance / **documentation-drift** <!-- @rule RL-b09e -->
- `surface`: screen + component <!-- @rule RL-61b3 -->
- `contract_ref`: clause in `docs/instructions/design-system/*.md` violated <!-- @rule RL-5795 -->
- `evidence`: `file:line` for static; screenshot + selector for live <!-- @rule RL-9292 -->
- `resolution`: concrete fix (e.g. "replace `#1a73e8` at `Button.tsx:42` with `color.primary.500` from `tokens.md`") so an LLM can resolve without re-deriving context <!-- @rule RL-8d84 -->
- `status`: open / accepted / waived (with reason) / fixed <!-- @rule RL-c1c2 -->
- `playbook_ref`: link to playbook snippet that reproduces it <!-- @rule RL-7713 -->

`token` findings default to **high** severity (raises visibility of hard-coded design values from day one). `documentation-drift` defaults to medium; rises to high if drift is in the contract itself (token declared in `tokens.md` never used, or used in code but not declared).

### Step 5 — write-report

- `docs/design-test/<timestamp>.md` — human report <!-- @rule RL-08b6 -->
- `docs/design-test/<timestamp>.json` — machine sidecar (so `design-retest` preserves IDs) <!-- @rule RL-77ab -->
- **DS-COV Coverage Matrix** — every contract clause × every route → covered/blocked (analog of WSTG matrix) <!-- @rule RL-24fa -->
- Ordered findings (blocker → nit), remediation priorities, link to playbook <!-- @rule RL-02a5 -->

#### DS-COV Coverage Matrix Template

| Contract clause                      | Route      | Status            |
| ------------------------------------ | ---------- | ----------------- |
| tokens.md → color.primary.500        | /pricing   | covered / blocked |
| tokens.md → spacing.4                | /          | covered / blocked |
| components.md → Button > hover state | /signup    | covered / blocked |
| accessibility.md → WCAG-2.2-1.4.3    | (all)      | covered / blocked |
| motion.md → reduced-motion respected | (all)      | covered / blocked |
| responsive.md → breakpoint:sm        | (all)      | covered / blocked |
| patterns.md → override budget        | (codebase) | covered / blocked |

## Footprint Policy

**Zero project footprint.** Diverges from pentest's "scripts live in the project" model — pentest scripts are meant to be tweakable by the project's security team; design-test scripts are infrastructure the project shouldn't touch. This divergence is intentional.

- All runners (scan-tokens, scan-overrides, enumerate-surface, axe-static, coverage, runtime-checks, retest) live inside paqad-ai under `runtime/scripts/design/`. <!-- @rule RL-bbcc -->
- `runtime-checks.ts` is a `.ts` file (Playwright is a Node API), run via `tsx` shipped as a paqad-ai dep. <!-- @rule RL-5b4d -->
- Stack-specific behavior is **framework code** inside the runners — they read the project's `package.json`, `playwright.config.ts`, `tailwind.config.*`, CSS-in-JS imports — and branch internally. One runner, many stacks. <!-- @rule RL-5d56 -->
- Outputs land in the project (`docs/design-test/*`, `.paqad/design-test/runs/*`) — work products, not infrastructure. Same pattern as pentest. <!-- @rule RL-bb26 -->

## What Is and Isn't Project-Tunable

**Framework-owned, not project-editable:**

- This workflow rule and `design-retest.md` <!-- @rule RL-0678 -->
- All 9 skills (the 8 review skills + `design-system-sync`) <!-- @rule RL-20a0 -->
- Runners under `runtime/scripts/design/` <!-- @rule RL-a1d2 -->
- Routing rules <!-- @rule RL-eb3c -->
- Finding schema and severity vocabulary <!-- @rule RL-5e21 -->

**Project-tunable, via declarative inputs only:**

- The contract itself: `docs/instructions/design-system/*.md` <!-- @rule RL-d6cd -->
- A bounded `design_test` config block (schema-validated) in `project-profile.yaml`: <!-- @rule RL-6e87 -->
  - `design_test.strict: true|false` (default false — advisory unless opted in) <!-- @rule RL-3069 -->
  - `design_test.app_url` <!-- @rule RL-e5c8 -->
  - `design_test.dev_command` <!-- @rule RL-6559 -->
  - `design_test.routes_include` / `routes_exclude` <!-- @rule RL-32bb -->
  - `design_test.baselines_path` <!-- @rule RL-8c37 -->
  - `design_test.budgets` (schema framework-defined; values project-supplied) <!-- @rule RL-e0c0 -->
  - `design_test.with: [visual-regression, dark-mode-parity, rtl-parity, i18n-width]` (optional checks) <!-- @rule RL-27c5 -->

**Explicitly off-limits:**

- Project-side plugins loaded by the runner <!-- @rule RL-d1f5 -->
- Project-side scripts the workflow shells out to <!-- @rule RL-24f3 -->
- Project-overridable thresholds outside the declared schema <!-- @rule RL-08a1 -->
- Swapping a framework skill for a project-custom one <!-- @rule RL-70ea -->
- Editing this workflow rule in the project <!-- @rule RL-da85 -->

## Rules

- Never skip steps. If a script is unavailable, record it in `blocked_checks` and proceed. <!-- @rule RL-06c9 -->
- Do not run destructive operations (no writes to the live database, no mutations via the API). The Playwright walk is read-only. <!-- @rule RL-eaec -->
- Always write both the `.md` report and the `.json` sidecar; the `design-retest` workflow depends on the sidecar to preserve `DT-XXXX` IDs. <!-- @rule RL-e17d -->
- The local design playbook (Step 2.5) is **generated only** — never execute it automatically. <!-- @rule RL-f2f2 -->
- `docs/modules/*/ui/**` is never evidence; any disagreement with the AST-derived inventory produces a `documentation-drift` finding. <!-- @rule RL-c0dd -->
- Hard-coded design values (hex, raw px/rem, ad-hoc font stacks) are never acceptable when a token exists. `token` findings default to high severity. <!-- @rule RL-b216 -->
