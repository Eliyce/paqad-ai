# Security

Baseline security expectations for every change, regardless of stack.

- Never commit secrets, credentials, or tokens. Load them from environment variables or a secrets manager, and keep them out of logs, error messages, and docs. <!-- @rule RL-6c84 -->
- Validate and sanitize all external input at the trust boundary before using it. <!-- @rule RL-fac9 -->
- Use parameterized queries and prepared statements; never assemble SQL, shell commands, or HTML by concatenating untrusted input. <!-- @rule RL-4890 -->
- Enforce authentication and authorization on every non-public entry point; default to deny. <!-- @rule RL-0c4f -->
- Apply least privilege to integrations, tokens, and file/database access. <!-- @rule RL-fe8d -->
- Confirm destructive or irreversible operations before running them. <!-- @rule RL-a1db -->
