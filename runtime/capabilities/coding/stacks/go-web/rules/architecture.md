# Go Web Architecture

- Keep handler, service, repository, and transport boundaries explicit; avoid merging them in a single file when behavior is non-trivial.
- Place route registration in one location (`cmd/` or `internal/server/`); keep handler logic in `internal/handler/` or feature-scoped packages.
- Business logic belongs in the service layer, not in HTTP handlers or database queries.
- Centralize middleware (auth, logging, recovery, CORS) and apply it at the router level, not inside individual handlers.
- Reflect changed route, service contract, and configuration behavior in the matching canonical docs.
