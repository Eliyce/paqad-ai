# Rust Web Security

- Enforce authentication and authorization with a `tower` middleware layer or a custom extractor whose `FromRequestParts` rejects unauthenticated requests before the handler body runs; do not rely on per-handler ad-hoc checks.
- Review any `unsafe` block for memory safety and data-race exposure, and document the invariant that justifies it with a `// SAFETY:` comment.
- Mark fields that must never appear in API responses with `#[serde(skip)]`, and prefer dedicated response DTOs over serializing domain/persistence structs directly.
- Use parameterized queries (`sqlx` bind parameters / the ORM's binding); never interpolate user input into SQL strings.
- Load secrets from environment variables via `std::env` or a crate like `dotenvy`, and reject startup if a required secret is absent.
- Eliminate panicking paths reachable from request input — replace `unwrap`/`expect`/array indexing/`unwrap` on parsed input with `Result` handling so malformed or adversarial input cannot crash the worker.
- Bound request size and time with `tower-http` (`RequestBodyLimitLayer`, `TimeoutLayer`) so oversized or slow requests cannot exhaust memory or tie up connections.
