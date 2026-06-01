# Remix / React Router (framework mode)

- This stack is React Router v7 framework mode (the successor to Remix v2); import data/routing APIs from `react-router`. For existing Remix apps, migrate `@remix-run/*` imports via the official codemod rather than mixing both.
- Load route data in a `loader` and perform mutations in an `action`; do not refetch the same data with ad hoc client `fetch`/`useEffect` when a loader can serve it.
- Loaders and actions run on the server — keep secrets and direct DB/API access there, and validate/parse all `request` input (form data, params, search params) before use.
- Submit mutations with `<Form>`/`useFetcher` so they work without JS and trigger automatic revalidation of affected loaders; avoid hand-rolled fetch-then-manually-refresh flows.
- Use `useFetcher` for non-navigating mutations and `useNavigation`/`fetcher.state` to drive pending and optimistic UI.
- Throw a `Response` (e.g. `throw redirect(...)` or a 404) from loaders/actions for redirects and error paths; render failures with a route `ErrorBoundary`.
- Structure nested routes so the URL hierarchy mirrors layout nesting, and load each segment's data in its own loader rather than one root loader fetching everything.
- Type loader/action data with `useLoaderData<typeof loader>()` instead of casting to `any`.
