# Design-System Sync Rules

When the diff touches design-system surfaces, propose the matching contract update.

## Token sources

- `src/design-tokens/colors.ts` adds `primaryDark: '#0d47a1'` → propose `tokens.md` append: `color.primary.dark = #0d47a1`.
- `tailwind.config.*` `theme.extend.colors.brand = '#abcdef'` → propose `tokens.md` append: `color.brand = #abcdef`.
- `tailwind.config.*` `theme.extend.spacing` entries → propose `tokens.md` spacing namespace updates.
- A token removal in source → propose removal from `tokens.md` only if no code references it. If references remain, raise a `token` finding instead.

## Component sources

- New file `src/components/Foo.tsx` → propose `components.md` entry: name `Foo`, variants `[]`, states `[default, hover, focus, disabled]` (default set), composition `TBD`. Flag the `TBD` so the user fills it in.
- Removed component → propose `components.md` entry removal.
- Renamed component → propose rename in `components.md` and cross-reference any `components.md` entry that mentions the old name.

## Breakpoint sources

- `tailwind.config.*` `theme.screens` entries → propose `responsive.md` breakpoint append.

## Never auto-apply

- All proposals are unified diffs the workflow surfaces via the Decision Pause Contract. The user accepts or modifies; this skill never writes the contract directly.
