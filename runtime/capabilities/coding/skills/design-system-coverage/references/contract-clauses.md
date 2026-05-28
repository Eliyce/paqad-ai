# Design-System Contract Clauses

What counts as a clause in each contract file. Counts inform the tier decision; the inventory itself is consumed by every downstream design-test skill.

## tokens.md

A clause is one **declared token**. Tokens group by namespace:

- `color.*` — e.g. `color.primary.500`, `color.surface.subtle`. Hex values are the declared truth; any other hex in the codebase is a `token` finding.
- `spacing.*` — e.g. `spacing.4`, `spacing.gutter`. Raw px/rem outside this set is a finding.
- `radius.*` — corner radii.
- `shadow.*` — declared elevations.
- `font.family.*`, `font.size.*`, `font.weight.*`, `font.line-height.*` — typography tokens. Ad-hoc font stacks or sizes outside this set are findings.
- `motion.duration.*`, `motion.easing.*` — animation tokens.
- `breakpoint.*` — declared media-query breakpoints.

A token clause is _non-empty_ if it has a value AND a name; a placeholder like `TBD` does not count.

## components.md

A clause is one **declared component** plus its declared variants and states. A bare component name with no states/variants counts as 0.5 — present but incomplete.

Expected per-component metadata: variants (e.g. `primary | secondary | ghost`), states (`default / hover / focus / disabled / loading / error / empty`), permitted compositions.

## accessibility.md

A clause is one **declared a11y rule**: contrast minimum, focus-ring spec, target-size minimum, ARIA landmark requirement, keyboard-order rule, prefers-reduced-motion guarantee. Each must map to a WCAG 2.2 success criterion id.

## responsive.md

A clause is one **declared breakpoint** plus its rules (max content width, gutter, column count, RTL support).

## motion.md

A clause is one **declared motion budget**: max duration class, easing curve set, reduced-motion behavior.

## patterns.md

A clause is one **declared pattern**: override budget (`max_inline_styles`, `max_important_rules`), voice/tone vocabulary, perf budget (LCP/CLS/INP), critical-flow inventory.

## Tier Decision

- `missing` — every file either absent or empty.
- `bare` — tokens present but partial (≤ 50% of namespaces); no `components.md` inventory; no `accessibility.md` rules.
- `adequate` — tokens present in all required namespaces, `components.md` populated, `accessibility.md` populated, at least one of `{patterns, motion, responsive}` populated.
- `strong` — all six files populated.

The tier never depends on counts alone — `validate-contract.sh` enforces that an `adequate` tier has non-empty clause arrays for tokens, components, and accessibility.
