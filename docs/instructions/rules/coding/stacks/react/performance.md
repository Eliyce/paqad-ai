# React Performance

Loads when you optimize React rendering or bundle size. Sharpens `_shared/performance.md` with React specifics.

- Optimize only a re-render you have confirmed is expensive with the React DevTools Profiler. MUST NOT scatter `memo`/`useMemo`/`useCallback` speculatively.
- With React Compiler enabled, add no manual `memo`/`useMemo`/`useCallback`. Let the compiler memoize. Without it, wrap a child in `React.memo` only when it re-renders often with unchanged props, and pass it stable callbacks and objects via `useCallback`/`useMemo`.
- Code-split a heavy or rarely used route or component with `React.lazy` + `<Suspense>` (or the framework's route-level lazy loading) instead of shipping it in the initial bundle.
- Give every `<Suspense>` a meaningful `fallback`, and place the boundary so a slow section does not block unrelated UI.
- Start independent fetches in parallel (`Promise.all` or parallel queries) rather than awaiting them in sequence, and let the data library dedupe and cache. Avoid request waterfalls.
- Virtualize a long list with `@tanstack/react-virtual` or similar instead of rendering thousands of DOM nodes.
- Change a component's `key` only to reset its state on purpose; a key that changes every render forces a full remount.
