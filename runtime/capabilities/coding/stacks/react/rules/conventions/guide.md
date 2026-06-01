# React Conventions

- Name components in `PascalCase` and hooks `useX`; only functions whose name starts with `use` may call other hooks.
- Call hooks unconditionally at the top level of a component or custom hook — never inside conditions, loops, `try/catch`, or after an early `return`.
- Type component props with an explicit `interface`/`type`; do not use `React.FC` (it is discouraged and implies an unwanted `children` prop). Type children as `ReactNode` when needed.
- Provide a stable, domain-derived `key` on list items (an entity id), never the array index for lists that can reorder, insert, or delete.
- Pass `useEffect` a dependency array listing every reactive value it reads; do not disable `react-hooks/exhaustive-deps` to silence a missing dependency — fix the dependency instead.
- Prefer derived values computed during render over storing redundant copies in state that must be kept in sync via effects.
- Treat state as immutable: produce new objects/arrays (spread, `map`, `filter`) instead of mutating the existing value before `setState`.
