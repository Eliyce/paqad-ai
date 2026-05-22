# Rust Web Security Review Checklist

- Validate middleware extractor ordering: authentication extractors must be declared before handler arguments.
- Check for unsafe code blocks: review any `unsafe` usage for memory safety and data-race exposure.
- Review serialization with `serde`: confirm sensitive fields use `#[serde(skip_serializing)]` where appropriate.
- Confirm secrets are loaded from environment variables via `std::env` or a crate like `dotenvy`; no hardcoded values.
- Check for panicking code paths in request handlers that could be triggered by malformed input.
