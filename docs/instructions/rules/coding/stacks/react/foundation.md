# React Foundation

- Use the project's existing router, data-fetching, and state libraries (e.g. React Router/TanStack Router, TanStack Query, Redux Toolkit, Zustand) instead of hand-rolling caching, routing, or global stores. <!-- @rule RL-1b5c -->
- Reach for `useState`/`useReducer` for local state and Context only for low-frequency shared values (theme, auth user); do not use Context as a high-frequency global store — every consumer re-renders on each change. <!-- @rule RL-3fcd -->
- Read external/changing values that are not React state with `useSyncExternalStore` rather than subscribing manually in `useEffect`. <!-- @rule RL-d482 -->
- Manage controlled inputs with React state; do not mix uncontrolled DOM reads (`ref.current.value`) with a controlled `value` prop on the same input. <!-- @rule RL-9e72 -->
- Prefer composition (passing `children`/render props) over deep prop drilling or premature higher-order-component abstractions. <!-- @rule RL-5322 -->
