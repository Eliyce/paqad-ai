# Design System Overview

paqad-ai's primary surface is a CLI. The only UI surface is the embedded `graph-ui/` React SPA used for visualizing project graphs.

## Surfaces

| Surface       | Technology               | Owner module     |
| ------------- | ------------------------ | ---------------- |
| CLI output    | chalk + ora (TTY)        | `src/cli/ui`     |
| Interactive prompts | `@inquirer/prompts`| `src/cli`        |
| Graph SPA     | React 19 + Tailwind 4    | `graph-ui/`      |

## CLI UX Conventions

- Use `chalk` for severity color: red = error/block, yellow = warn, green = success, dim = secondary.
- Use `ora` spinners only for operations that may take > 1s.
- Prompts go through `@inquirer/prompts`; never use ad-hoc `readline`.
- Respect non-TTY mode — fall back to plain output, no spinners, no color when `process.stdout.isTTY` is false.

## graph-ui Conventions

- Tailwind 4 utility-first; no separate CSS modules unless a component crosses ~50 utility classes.
- Component files colocate styles and logic.
- React 19 features (use, async transitions) are allowed.

## Design Tokens

Token sources live in `src/design-tokens/`. Token templates ship under `runtime/templates/design-system/`:

- `tokens.md.hbs`
- `components.md.hbs`
- `accessibility.md.hbs`
- `motion.md.hbs`
- `patterns.md.hbs`
- `responsive.md.hbs`

If the design system grows beyond `graph-ui/`, expand this directory with rendered versions of the above.

## Accessibility

- All interactive elements in `graph-ui/` must be keyboard-reachable.
- CLI output should not encode information in color alone — pair with prefixes (`✓`, `✗`, `→`).
