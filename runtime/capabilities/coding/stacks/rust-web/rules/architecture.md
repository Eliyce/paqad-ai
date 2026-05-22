# Rust Web Architecture

- Keep handler, service, repository, and extractor boundaries explicit; avoid merging them in a single file when behavior is non-trivial.
- Place route registration in one location (typically `main.rs` or a `router` module); keep handler logic in a `handlers` or feature-scoped module.
- Business logic belongs in the service layer, not in Axum handlers or database query functions.
- Centralize middleware (auth, tracing, CORS, compression) using `tower` layers applied at the router level.
- Reflect changed route, service contract, and state injection behavior in the matching canonical docs.
