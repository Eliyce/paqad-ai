# Tailwind CSS with Laravel

- Apply utility classes directly in component templates; avoid creating custom CSS unless a utility composition is used three or more times and extracting a component is not practical.
- Use `@apply` in component-scoped styles sparingly and only for repeated utility patterns that cannot be extracted into a reusable component.
- Define all project-specific design tokens (colours, spacing, typography) in `tailwind.config.js` under the `theme.extend` key; do not hardcode raw values in templates.
- Use the `class:` directive (Vue) or `clsx`/`cn` helpers (React) for conditional classes; avoid string concatenation for dynamic class lists.
- Keep responsive variants (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`) co-located with the base utility in the same class list.
- Use dark mode utilities (`dark:`) only when the project has an explicit dark mode strategy defined in the design system.
- Purge unused styles in production by ensuring `content` paths in `tailwind.config.js` cover all template files.
- Do not mix Tailwind utilities with Bootstrap or other CSS framework classes in the same component.
- Document any custom Tailwind plugins or extended utilities in `docs/design-system/tokens.md`.
