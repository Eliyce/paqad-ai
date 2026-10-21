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
- On the terminal, colour comes from the engine's named palette, one tone per state: `working` is
  suggestion, `needs-you` is permission (amber), `good` is success, `warn` is warning, `bad` is
  error and `neutral` has no colour. Any open flag turns a good, working or neutral band to warn.
- On the terminal, every state is said in words and by a mark of its own shape (`●` done, `▸`
  running, `○` not yet, `–` not required, `✗` failed, `◐` marked), so nothing is told by colour
  alone. The terminal keeps these marks, its controls and their one-letter hotkeys.
- On Desktop, the band's strip and the Ledger's rings, nodes, meters and rules are plain-image
  `Svg` art drawn in the HUD palette (`runtime/claude-plugin/mod/palette.ts`), and the Desktop
  drawing rules R1 to R15 apply. Tokens, components, patterns and the rules are in
  [hud.md](hud.md).
- Every Desktop `Svg` carries an `alt` text that states the same fact in words.
- Each Button names its action in words. Desktop has no hotkeys.
- Motion marks only what is live, and nothing settled moves. On Desktop the live light breathes
  through the `BREATH` alphas and the live clock ticks on a 400 ms tick; in the strip the running
  stage pulses (1.6 s) with a glow and a sweeping sheen (2.2 s), a writing seat and a chief needing
  answers pulse (1.6 s), the chief ruling and a delivery step running without a count spin (4 s),
  the CI arc grows with the share of jobs done, and a ready-to-merge node glows (2.4 s). The tick
  runs only while a live state is drawn. The terminal draws no animation; its clock follows the
  snapshot ticker.

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
