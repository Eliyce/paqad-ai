## Findings

- **blocker** (WCAG-2.2-1.4.3) — {{module}} / a11y: text contrast 3.8:1 on `/pricing` (token pair `color.text.muted` on `color.surface.base`); minimum is 4.5:1. Evidence: `axe results /pricing #plan-name`. Required action: darken `color.text.muted` in `tokens.md` until the pair meets 4.5:1, OR use `color.text.primary` for this surface.
- **high** (WCAG-2.2-2.4.7) — {{module}} / a11y: `outline: none` without replacement focus ring on `Button.primary`. Evidence: `src/components/Button.tsx:34`. Required action: remove `outline: none` or add a visible focus-visible ring per `accessibility.md` clause `focus-ring`.

## Open Questions

- {{omit when none}}
