# Responsive Checklist

For each route × declared breakpoint:

- **No horizontal scroll.** `document.documentElement.scrollWidth <= window.innerWidth`. Violation → `high`.
- **Touch targets ≥ declared minimum.** Default 24×24 (WCAG-2.2-2.5.8 minimum); declare 44×44 in `responsive.md` for mobile-first apps.
- **Content max-width respected.** Wide screens should not stretch text columns past the declared `responsive.md` clause.
- **Sticky elements don't obscure focus.** Cross-link `WCAG-2.2-2.4.11`.
- **Images and media scale.** No fixed-px images that overflow the viewport.

## RTL parity (when declared)

- `dir="rtl"` walk catches: directional icons that should mirror (arrows, chevrons), padding/margin asymmetry, text alignment, scroll direction.
- Components using `margin-left` / `padding-right` instead of `margin-inline-start` / `padding-inline-end` are findings.

## Exemptions

- Test pages (`/_test`, `/__playwright`) excluded automatically.
