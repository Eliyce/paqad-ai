# Next.js Conventions

- Prefer `app/` routes when present; treat `pages/` as a legacy or compatibility router.
- Keep route handlers in `app/api/**/route.ts` or `pages/api/**` and validate all server inputs.
- Keep shared UI in `components/` and avoid mixing server-only code into client components without explicit boundaries.
- Treat middleware and Server Actions as public entry points that require authentication and input validation.
