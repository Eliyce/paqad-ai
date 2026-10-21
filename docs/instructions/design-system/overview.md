# Design System Overview

paqad-ai's primary surface is a CLI. The only UI surface is the embedded `graph-ui/` React SPA: the project dashboard. Graph is one area inside it (opened with `paqad-ai dashboard`, then the **Graph** nav item), alongside Pulse, Approvals, Trust, Build, and the rest.

## Surfaces

| Surface       | Technology               | Owner module     |
| ------------- | ------------------------ | ---------------- |
| CLI output    | chalk + ora (TTY)        | `src/cli/ui`     |
| Interactive prompts | `@inquirer/prompts`| `src/cli`        |
| Graph SPA     | React 19 + Tailwind 4    | `graph-ui/`      |
| HUD mod       | Claude Code mod elements | `runtime/claude-plugin/mod/` |

## CLI UX Conventions

- Use `chalk` for severity color: red = error/block, yellow = warn, green = success, dim = secondary.
- Use `ora` spinners only for operations that may take > 1s.
- Prompts go through `@inquirer/prompts`; never use ad-hoc `readline`.
- Respect non-TTY mode — fall back to plain output, no spinners, no color when `process.stdout.isTTY` is false.

## graph-ui Conventions

- Tailwind 4 utility-first; no separate CSS modules unless a component crosses ~50 utility classes.
- Component files colocate styles and logic.
- React 19 features (use, async transitions) are allowed.

## HUD mod Conventions

- The HUD draws only with the Claude Code mod elements: `Box`, `Text`, `Button`, `Link` and, on
  Desktop only, `Svg`. The terminal never gets an `Svg`; it draws its own text marks.
- Colour comes from the engine's named palette, one tone per state: `working` is suggestion,
  `needs-you` is permission (amber), `good` is success, `warn` is warning, `bad` is error and
  `neutral` has no colour. Any open flag turns a good, working or neutral band to warn.
- Every state is said in words and by a mark of its own shape (`●` done, `▸` running, `○` not yet,
  `–` not required, `✗` failed, `◐` marked), so nothing is told by colour alone.
- Every Desktop `Svg` carries an `alt` text that states the same fact in words. Its colours are
  named constants in the mod, kept in one place so they can become tokens later.
- Each Button names its action in words; the band controls also have a one-letter hotkey.
- There is no motion: the static marks and pictures carry the whole meaning.

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
