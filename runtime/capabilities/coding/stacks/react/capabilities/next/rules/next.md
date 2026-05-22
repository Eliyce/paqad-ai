# Next.js

- Keep the App Router or Pages Router choice consistent within the project; do not mix patterns without an explicit migration boundary.
- Prefer server components, server actions, and route handlers for server-only work; keep browser-only logic in client components.
- Put data loading, cache invalidation, and revalidation strategy next to the route that owns it.
- Keep metadata, layouts, loading UI, and error boundaries aligned with the route segment they protect.
- Validate changed navigation, loading, and error behavior with browser checks when route semantics change.
