# React Foundation

Loads when you set up React state, data, and composition.

- Use the project's existing router, data-fetching, and state libraries (React Router / TanStack Router, TanStack Query, Redux Toolkit, Zustand) rather than hand-rolling caching, routing, or a global store.
- Keep `useState`/`useReducer` for local state, and use Context only for low-frequency shared values (theme, auth user). MUST NOT use Context as a high-frequency store. Every consumer re-renders on each change.
- Read a changing external (non-React) value with `useSyncExternalStore`, not a manual subscription inside `useEffect`.
- Drive a controlled input from React state. MUST NOT mix an uncontrolled DOM read (`ref.current.value`) with a controlled `value` prop on the same input.
- Prefer composition (`children`, render props) over deep prop drilling or a premature higher-order component.
