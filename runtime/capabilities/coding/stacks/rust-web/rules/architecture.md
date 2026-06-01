# Rust Web Architecture

- Module ownership and boundaries are defined per-project in `docs/instructions/rules/module-map.yml` — treat that file as the source of truth for which module/crate owns which directory, and do not duplicate or contradict it here.
- Keep handler, service, and repository responsibilities in distinct layers; Axum handlers extract/validate input and build the response, services hold business logic, repositories own data access.
- Register routes in one place (`main.rs` or a dedicated `router` module) and keep handler functions in a `handlers`/feature module; share state with `Router::with_state` and the `State` extractor, not globals.
- Apply cross-cutting concerns (auth, tracing, CORS, compression, timeouts) as `tower`/`tower-http` layers on the router via `Router::layer`, not inside individual handlers.
- Define error handling once: a domain error type implementing `IntoResponse` (or `axum::response::Result`) so handlers return `Result<T, AppError>` instead of mapping status codes ad hoc.
