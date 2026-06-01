# Rust Web Environment

- Resolve configuration into one typed config struct at startup (deserialized via the `config` crate or parsed from env with `dotenvy` loading `.env`), not scattered `std::env::var` calls in handlers.
- Fail fast at startup when a required value is missing or fails to parse: return/propagate an error from `main` (or `expect` only here) that names the offending key; do not start the server with a half-populated config.
- Keep real secrets out of the repo — commit a `.env.example` with keys and empty values, and load actual secrets from the environment or a secrets manager.
- Parse into typed fields at load time (durations, ports, URLs) so downstream code consumes `Duration`/`u16`/typed values rather than raw strings.
