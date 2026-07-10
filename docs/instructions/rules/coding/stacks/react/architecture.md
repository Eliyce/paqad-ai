# React Architecture

Loads when you add or move React modules and components.

- Treat `docs/instructions/rules/module-map.yml` as the source of truth for which feature owns which directory. MUST NOT invent a parallel folder taxonomy.
- Keep components pure during render: MUST NOT mutate props, state, or module-level variables, call `fetch`, or read `Date.now()`/`Math.random()` in the component body. Put side effects in event handlers or `useEffect`.
- Co-locate a feature's components, hooks, and tests, and import across features only through each feature's public entry module. Never deep-import another feature's internal file.
- Define one canonical module per concern (the API/HTTP client, the router config, the shared UI primitives) and import from it, rather than re-instantiating a client or re-declaring a route path per feature.
- With React Server Components, only a file marked `'use client'` may use hooks, browser APIs, or event-handler props. Keep data fetching and secrets in server components, and pass plain serializable props across the boundary.
