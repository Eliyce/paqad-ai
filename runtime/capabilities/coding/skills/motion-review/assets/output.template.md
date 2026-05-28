## Findings

- **high** (motion.md → reduced-motion) — {{module}} / motion: `Toast` slide-in animation runs regardless of `prefers-reduced-motion: reduce`. Evidence: `src/components/Toast.tsx:42`. Required action: wrap the keyframes in `@media (prefers-reduced-motion: reduce)` and disable, or use `useReducedMotion`.
- **medium** (motion.md → duration) — {{module}} / motion: 800ms transition exceeds declared 400ms ceiling. Evidence: `src/styles/modal.css:18`. Required action: shorten to `motion.duration.medium` (≤ 400ms) per `motion.md`.

## Open Questions

- {{omit when none}}
