## Findings

- **high** (components.md → Button) — {{module}} / component: variant `ghost` declared in `components.md` but not implemented in source. Evidence: `src/components/Button.tsx:1`. Required action: add `variant: 'ghost'` branch to `Button` per `components.md` clause.
- **medium** (patterns.md → override budget) — {{module}} / component: inline `style={{ background: '#1a73e8' }}` overrides declared `variant` prop. Evidence: `src/pages/Pricing.tsx:88`. Required action: use `<Button variant="primary">` instead of inline style override.

## Open Questions

- {{omit when none}}
