# React.js with Laravel

- Use functional components and hooks exclusively; avoid class components.
- Co-locate component logic, markup, and styles within the same feature directory.
- Prefer server-side data passing via Inertia props or API resources over client-side fetching for initial page loads.
- Use `React.memo`, `useMemo`, and `useCallback` only when measurable re-render cost exists; do not add them preemptively.
- Keep component files focused: one primary component per file, shared helpers extracted to `resources/js/shared/`.
- Type all props with TypeScript interfaces or type aliases; never use `any`.
- Validate and sanitize all user inputs before submission; do not trust frontend-only validation.
- Write unit tests for components with significant logic using Vitest and React Testing Library.
- Provide a stable `key` for every list item rendered with `.map()`; use the record's id, not the array index.
- Specify the full dependency array for `useEffect`/`useMemo`/`useCallback`; do not omit dependencies or pass `[]` when the effect reads changing values.
- Place page components under `resources/js/Pages/` (Inertia) and shared/reusable components under `resources/js/Components/`, matching the project's established layout.
- Document non-obvious component behaviour and prop contracts in the corresponding module UI doc.
