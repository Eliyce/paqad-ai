# Tailwind CSS with Laravel

- Style with utility classes in markup; do not write custom CSS until a utility composition repeats and cannot be factored into a reusable component instead.
- Reserve `@apply` for genuinely repeated utility patterns that resist component extraction; do not rebuild a utility-first stylesheet as bespoke `@apply` rules.
- Define design tokens (colors, spacing, fonts) once and reference them everywhere: in Tailwind v4 via the `@theme` block in the CSS entry file; in v3 via `theme.extend` in `tailwind.config.js`. Do not hardcode raw hex/px values in templates when a token exists.
- Build dynamic class lists with `clsx`/`cn` (React) or the `:class` binding (Vue); do not string-concatenate class names, and do not compute partial class names at runtime (`bg-${color}-500`) — Tailwind cannot detect them, so they get purged.
- Keep responsive (`sm:`/`md:`/`lg:`) and state (`hover:`/`focus:`/`dark:`) variants inline with their base utility in the same class list.
- Use `dark:` variants only when the project has a defined dark-mode strategy (the `dark` class or `media` strategy is actually configured).
- Ensure Tailwind sees all template files: in v4 add `@source` directives for paths outside automatic detection (e.g. Blade in `resources/views`, JS in `resources/js`); in v3 list them in the `content` array. Unscanned files mean missing classes in the production build.
- Do not mix Tailwind utilities with Bootstrap or another CSS framework's classes on the same element.
- Document custom Tailwind plugins or extended tokens in `docs/design-system/tokens.md`.
