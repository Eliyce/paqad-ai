## Findings

- **high** (tokens.md → color.primary.500) — {{module}} / token: hard-coded color `#1a73e8` instead of declared token. Evidence: `src/components/Button.tsx:42`. Required action: replace `#1a73e8` with `color.primary.500` from `docs/instructions/design-system/tokens.md`.
- **high** (tokens.md → spacing.4) — {{module}} / token: raw `16px` padding instead of declared spacing token. Evidence: `src/components/Card.tsx:18`. Required action: replace `padding: 16px` with `padding: spacing.4` (or Tailwind `p-4`).
- **medium** (tokens.md → shadow.sm) — {{module}} / token: hard-coded shadow value; no matching token declared. Evidence: `src/components/Panel.tsx:55`. Required action: add `shadow.sm` to `tokens.md` and reference it, or replace with the closest existing token.

## Open Questions

- {{omit when none}}
