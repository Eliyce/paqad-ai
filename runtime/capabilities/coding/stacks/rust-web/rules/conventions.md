# Rust Web Conventions

- Keep `cargo fmt` and `cargo clippy` clean before committing; treat clippy warnings as errors in CI and do not leave `#[allow(...)]` without a justifying comment.
- Return `Result<T, E>` for fallible operations and propagate with `?`; do not `unwrap`/`expect`/`panic!` in request-handling paths where input could be malformed.
- Define a domain error enum (commonly with `thiserror`) for library/service code and use `anyhow` only at the binary's top level; do not stringly-type errors.
- Prefer borrowing (`&T`, `&str`, `&[T]`) over taking ownership or `clone()` in function signatures; clone only when ownership is genuinely required.
- Use `async`/`.await` end-to-end on the Tokio runtime; never call blocking I/O or `std::thread::sleep` inside an async fn — use the async equivalent or `tokio::task::spawn_blocking`.
- Derive `Debug` on public types and derive `Serialize`/`Deserialize` only where serialization is intended; do not implement these by hand without reason.
- Name items per Rust convention: `snake_case` functions/modules, `UpperCamelCase` types/traits, `SCREAMING_SNAKE_CASE` consts.
- Document `unsafe` blocks with a `// SAFETY:` comment stating the invariant that makes them sound, and keep them minimal.
