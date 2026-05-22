# Nuxt

- Keep server routes, async data, and page-level data ownership aligned with the page or layout that consumes them.
- Use composables for shared behavior, but keep route-specific fetching and caching decisions at the page boundary.
- Keep runtime config, Nitro server behavior, and browser-only code separated explicitly.
- Treat layouts, middleware, loading states, and error pages as part of the route contract, not afterthoughts.
- Re-check navigation guards, SSR behavior, and hydration-sensitive UI when route data or runtime config changes.
