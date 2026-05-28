## Findings

- **high** (responsive.md → breakpoint:sm) — {{module}} / responsive: horizontal scroll on `/pricing` at 640px viewport. Evidence: `screenshot pricing-sm.png:scrollWidth=720`. Required action: ensure the pricing card grid wraps below `sm`; remove `min-width: 720px` from `Card.tsx:18`.
- **high** (WCAG-2.2-2.5.8) — {{module}} / responsive: touch target 18×18 on icon-only button. Evidence: `src/components/IconButton.tsx:12`. Required action: increase tap area to ≥ 24×24 (padded hit-area or larger icon).

## Open Questions

- {{omit when none}}
