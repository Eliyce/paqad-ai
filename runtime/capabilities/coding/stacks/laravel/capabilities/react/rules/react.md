# React.js with Laravel

- Use functional components and hooks exclusively; avoid class components.
- Co-locate component logic, markup, and styles within the same feature directory.
- Prefer server-side data passing via Inertia props or API resources over client-side fetching for initial page loads.
- Use `React.memo`, `useMemo`, and `useCallback` only when measurable re-render cost exists; do not add them preemptively.
- Keep component files focused: one primary component per file, shared helpers extracted to `resources/js/shared/`.
- Type all props with TypeScript interfaces or type aliases; never use `any`.
- Validate and sanitize all user inputs before submission; do not trust frontend-only validation.
- Write unit tests for components with significant logic using Vitest and React Testing Library.
- Keep `resources/js/` module boundaries aligned with Laravel module directories in `app/`.
- Document non-obvious component behaviour and prop contracts in the corresponding module UI doc.
