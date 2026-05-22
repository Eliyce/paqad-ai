# Rust Web Foundation

- Prefer Axum and standard ecosystem crates over custom scaffolding.
- Keep handlers thin: extract and validate input via typed extractors, delegate to a service or domain layer, return a typed response.
- Use the type system to make invalid states unrepresentable; avoid `unwrap` and `expect` in request-handling paths.
- Keep module boundaries intentional — one module per coherent responsibility, no circular dependencies.
