# Nuxt

- Fetch data with `useFetch`/`useAsyncData` (which dedupe and transfer server-rendered state to the client) rather than a bare `$fetch`/`fetch` inside `setup`, which double-fetches on hydration; use `$fetch` for event-driven calls in handlers.
- Pass a stable, unique `key` to `useAsyncData` for data that depends on params so caching and refresh behave correctly.
- Keep secrets in the top-level `runtimeConfig` (server-only) and browser-safe values in `runtimeConfig.public`; access them with `useRuntimeConfig()` instead of reading `process.env` in components.
- Put server-only logic (DB access, secret-bearing API calls) in `server/api`/`server/routes` (Nitro) and call those routes from the client; do not import server code into components.
- Rely on the file-based router (`pages/`), `layouts/`, and `middleware/`; use `definePageMeta` for per-route layout/middleware and `navigateTo` for programmatic navigation instead of hand-wiring routes.
- Let Nuxt auto-import composables/components from `composables/`, `utils/`, and `components/`; do not add redundant manual imports for auto-imported symbols.
- Guard browser-only APIs with `import.meta.client` (or `onMounted`) and SSR-only code with `import.meta.server` so universal code does not crash during server render or hydration.
- Surface fatal errors with `createError({ statusCode, ... })` and recover locally with `<NuxtErrorBoundary>`.
