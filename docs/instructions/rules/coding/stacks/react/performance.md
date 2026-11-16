# React Performance

Loads when you optimize React rendering or bundle size. Sharpens `_shared/performance.md` with React specifics.

- Optimize only a re-render you have confirmed is expensive with the React DevTools Profiler. MUST NOT scatter `memo`/`useMemo`/`useCallback` speculatively. <!-- @rule RL-8e9e -->
- With React Compiler enabled, add no manual `memo`/`useMemo`/`useCallback`. Let the compiler memoize. Without it, wrap a child in `React.memo` only when it re-renders often with unchanged props, and pass it stable callbacks and objects via `useCallback`/`useMemo`. <!-- @rule RL-62c5 -->
- Code-split a heavy or rarely used route or component with `React.lazy` + `<Suspense>` (or the framework's route-level lazy loading) instead of shipping it in the initial bundle. <!-- @rule RL-71e8 -->
- Give every `<Suspense>` a meaningful `fallback`, and place the boundary so a slow section does not block unrelated UI. <!-- @rule RL-4f0c -->
- Start independent fetches in parallel (`Promise.all` or parallel queries) rather than awaiting them in sequence, and let the data library dedupe and cache. Avoid request waterfalls. <!-- @rule RL-585e -->
- Virtualize a long list with `@tanstack/react-virtual` or similar instead of rendering thousands of DOM nodes. <!-- @rule RL-14c6 -->
- Change a component's `key` only to reset its state on purpose; a key that changes every render forces a full remount. <!-- @rule RL-32b8 -->
- A store selector that builds a new object or array (object literal, map, filter, slice) is wrapped in useShallow from zustand/shallow. <!-- @rule RL-eb85 discovered:rd-20261116-061901 -->
- No store hook is called with a custom equality function as a second argument; use useShallow, or createWithEqualityFn from zustand/traditional where equality is truly needed. <!-- @rule RL-91ad discovered:rd-20261116-061901 -->
- Callbacks and object props passed to <ReactFlow> are module constants or wrapped in useCallback/useMemo, never inline arrow functions or object literals. <!-- @rule RL-b575 discovered:rd-20261116-061901 -->
- The nodeTypes and edgeTypes objects are declared at module scope (or in useMemo with an empty dependency list), and custom node components are declared outside the rendering component or wrapped in React.memo. <!-- @rule RL-01f1 discovered:rd-20261116-061901 -->
- Components rendered inside a flow select narrow fields from useStore (for example the zoom value) and never subscribe to the whole nodes or edges array. <!-- @rule RL-bc1f discovered:rd-20261116-061901 -->
