# React Architecture

- Module ownership and boundaries are defined per-project in `docs/instructions/rules/module-map.yml`; treat that file as the source of truth for which feature owns which directory, and do not invent a parallel folder taxonomy.
- Keep components pure during render: do not mutate props, state, or module-level variables, perform `fetch`, or read `Date.now()`/`Math.random()` in the component body. Put side effects in event handlers or `useEffect`.
- Co-locate a feature's components, hooks, and tests; import across features only through each feature's public entry module, never deep-import another feature's internal files.
- Define one canonical module per concern — the API/HTTP client, the router config, and shared UI primitives — and import from it rather than re-instantiating clients or re-declaring route paths per feature.
- In codebases using React Server Components, only files marked `'use client'` may use hooks (`useState`, `useEffect`), browser APIs, or event handler props; keep data fetching and secrets in server components and pass plain serializable props across the boundary.
