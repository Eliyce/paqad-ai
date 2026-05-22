# Rust Web Testing Guide

Use the narrowest command that proves the changed behavior, then expand to the full gate before merge.

## Common Commands

- focused test: `cargo test "<pattern>"`
- full suite: `cargo test`
- lint: `cargo clippy --all-targets --all-features -- -D warnings`
- format check: `cargo fmt --check`
- if Docker Compose is active, prefix with `docker compose exec <rust-service>`

## Coverage Expectations

- cover happy path plus 401, 403, and validation-error responses that changed
- use `actix-web::test` or `axum::test` helpers for HTTP handler integration tests
