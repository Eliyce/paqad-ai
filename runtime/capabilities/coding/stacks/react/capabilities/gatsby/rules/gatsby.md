# Gatsby

- Keep page queries, static queries, and source plugin assumptions close to the page or component that owns them.
- Treat GraphQL schema changes as contract changes; update affected pages, fragments, and docs together.
- Prefer build-time data flows for static content and isolate runtime-only behavior clearly.
- Watch image, asset, and route generation behavior when changing source plugins or page creation logic.
- Re-verify generated routes and static build output after changing page templates or GraphQL data dependencies.
