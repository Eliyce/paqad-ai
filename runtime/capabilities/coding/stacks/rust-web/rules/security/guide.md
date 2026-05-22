# Rust Web Security

- Validate that authentication extractors are declared before handler arguments in Axum router state.
- Review any `unsafe` block for memory safety and data-race exposure; document the invariant that justifies it.
- Confirm sensitive fields use `#[serde(skip_serializing)]` to prevent accidental exposure in API responses.
- Load secrets from environment variables via `std::env` or a crate like `dotenvy`; reject startup if required secrets are absent.
- Eliminate panicking code paths in request handlers that could be triggered by malformed or adversarial input.
