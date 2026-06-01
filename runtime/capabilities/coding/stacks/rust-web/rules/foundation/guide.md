# Rust Web Foundation

- Prefer Axum and established ecosystem crates (`tokio`, `tower`/`tower-http`, `serde`, `sqlx`/`sea-orm`, `tracing`) over custom scaffolding.
- Keep handlers thin: extract and validate input via typed extractors (`Path`, `Query`, `Json`, `State`), delegate to a service/domain layer, and return a typed `impl IntoResponse`.
- Use the type system to make invalid states unrepresentable (newtypes, enums over bool flags, `Option`/`Result`); avoid `unwrap`/`expect` in request-handling paths.
- Return `Result<T, AppError>` from fallible handlers with an error type implementing `IntoResponse`, instead of panicking or unwrapping on bad input.
- Keep module boundaries intentional — one module per coherent responsibility, no circular dependencies; expose a deliberate public API with `pub`.
- Share state cheaply: wrap expensive shared resources in `Arc` and pass them via Axum `State` rather than cloning per request or using globals.
