# Remix

- Keep loaders and actions as the source of truth for route data and mutations; avoid duplicating the same flow with ad hoc client fetches.
- Validate form submissions, redirects, and error responses at the route boundary, not inside presentational components.
- Keep route modules focused: UI in the component, data in loaders/actions, shared logic in extracted services.
- Use nested routes, boundaries, and deferred data intentionally so the route tree reflects real ownership.
- Re-check optimistic UI, navigation state, and error boundaries when changing route data contracts.
