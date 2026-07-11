# React Conventions

Loads when you write React components and hooks.

- Name components in `PascalCase` and hooks `useX`; only a function whose name starts with `use` may call another hook. <!-- @rule RL-635d -->
- Call every hook unconditionally at the top level of a component or custom hook. MUST NOT call one inside a condition, loop, `try/catch`, or after an early `return`. <!-- @rule RL-1aed -->
- Type props with an explicit `interface` or `type`, and type children as `ReactNode`. MUST NOT use `React.FC`. It implies an unwanted `children` prop. <!-- @rule RL-693b -->
- Give each list item a stable, domain-derived `key` (an entity id). MUST NOT use the array index as `key` for a list that can reorder, insert, or delete. <!-- @rule RL-8dc0 -->
- List every reactive value a `useEffect` reads in its dependency array, and fix a missing dependency rather than disabling `react-hooks/exhaustive-deps`. <!-- @rule RL-1c65 -->
- Compute a derived value during render instead of storing a redundant copy in state that an effect has to resync. <!-- @rule RL-7888 -->
- Treat state as immutable: build a new object or array (spread, `map`, `filter`) instead of mutating the current value before `setState`. <!-- @rule RL-6881 -->

## Verify

```bash
# Rules of hooks and exhaustive-deps are enforced by the linter:
pnpm lint
# Array-index keys to review:
git grep -nE 'key=\{[^}]*\bindex\b' -- '*.tsx' '*.jsx'
# React.FC usage:
git grep -nE ':\s*React\.FC\b' -- '*.tsx'
```
