# Security

Baseline security expectations for every change, regardless of stack.

- Never commit secrets, credentials, or tokens. Load them from environment variables or a secrets manager, and keep them out of logs, error messages, and docs.
- Validate and sanitize all external input at the trust boundary before using it.
- Use parameterized queries and prepared statements; never assemble SQL, shell commands, or HTML by concatenating untrusted input.
- Enforce authentication and authorization on every non-public entry point; default to deny.
- Apply least privilege to integrations, tokens, and file/database access.
- Confirm destructive or irreversible operations before running them.
