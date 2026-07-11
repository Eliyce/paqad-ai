# React Performance

Loads when you optimize React rendering or bundle size. Sharpens `_shared/performance.md` with React specifics.

- Optimize only a re-render you have confirmed is expensive with the React DevTools Profiler. MUST NOT scatter `memo`/`useMemo`/`useCallback` speculatively. <!-- @rule RL-8e9e -->
- With React Compiler enabled, add no manual `memo`/`useMemo`/`useCallback`. Let the compiler memoize. Without it, wrap a child in `React.memo` only when it re-renders often with unchanged props, and pass it stable callbacks and objects via `useCallback`/`useMemo`. <!-- @rule RL-62c5 -->
- Code-split a heavy or rarely used route or component with `React.lazy` + `<Suspense>` (or the framework's route-level lazy loading) instead of shipping it in the initial bundle. <!-- @rule RL-71e8 -->
- Give every `<Suspense>` a meaningful `fallback`, and place the boundary so a slow section does not block unrelated UI. <!-- @rule RL-4f0c -->
- Start independent fetches in parallel (`Promise.all` or parallel queries) rather than awaiting them in sequence, and let the data library dedupe and cache. Avoid request waterfalls. <!-- @rule RL-585e -->
- Virtualize a long list with `@tanstack/react-virtual` or similar instead of rendering thousands of DOM nodes. <!-- @rule RL-14c6 -->
- Change a component's `key` only to reset its state on purpose; a key that changes every render forces a full remount. <!-- @rule RL-32b8 -->
