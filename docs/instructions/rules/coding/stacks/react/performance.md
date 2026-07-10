# React Performance

- Optimize only re-renders you have confirmed are expensive (via the React DevTools Profiler); do not sprinkle `memo`/`useMemo`/`useCallback` speculatively.
- If the project has React Compiler enabled, do not add manual `memo`/`useMemo`/`useCallback` — let the compiler memoize. Without the compiler, wrap a child in `React.memo` only when it re-renders often with unchanged props, and pass it stable callbacks/objects via `useCallback`/`useMemo`.
- Code-split heavy or rarely used routes/components with `React.lazy` + `<Suspense>` (or the framework's route-level lazy loading) instead of shipping everything in the initial bundle.
- Give every `<Suspense>` a meaningful `fallback`, and place boundaries so a slow section does not block unrelated UI.
- Avoid request waterfalls: start independent fetches in parallel (`Promise.all` or parallel queries) rather than awaiting them sequentially; let the data library dedupe and cache.
- Virtualize long lists (`@tanstack/react-virtual` or similar) instead of rendering thousands of DOM nodes.
- Use the `key` prop to reset component state intentionally; avoid changing keys on every render, which forces full remounts.
