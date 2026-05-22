# Rust Web Environment

- Resolve environment values through a typed config struct populated at startup via `dotenvy` or `config` crate, not scattered `std::env::var` calls.
- Fail fast at startup when required configuration is missing; surface the missing key in the error message.
- Keep development, staging, and production `.env` files separate and never commit secrets.
- Document any environment variable that changes routing, middleware, feature flag, or external service behavior.
