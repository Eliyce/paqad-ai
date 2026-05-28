# Motion Checklist

For each animation in source:

- **Duration ≤ declared ceiling.** `motion.md` typically declares 400ms for UI; transitions ≥ 500ms outside of full-page transitions are findings.
- **Easing in declared set.** No ad-hoc cubic-bezier values. If `motion.md` declares `motion.easing.standard | enter | exit`, use those.
- **Reduced-motion respected.** Every animation must either:
  - be wrapped in `@media (prefers-reduced-motion: reduce) { animation: none; transition: none; }`, OR
  - use a hook that reads the user preference (`useReducedMotion` from framer-motion), OR
  - be a sub-150ms ease (cosmetic flash, not motion).
- **No parallax tied to scroll** without reduced-motion fallback.
- **No infinite spinners** without an `aria-label` describing what is loading.

Live-phase signal: a reduced-motion screenshot that differs from the static screenshot in animated regions = the animation is not being suppressed.
