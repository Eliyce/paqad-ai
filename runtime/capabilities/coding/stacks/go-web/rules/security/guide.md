# Go Web Security

- Validate all authentication and authorization middleware runs before handler logic in the middleware chain.
- Use parameterized queries via `database/sql` or an ORM; never interpolate user input into raw SQL.
- Pass auth principals via `context.Context`; do not use global or package-level state for request-scoped identity.
- Load secrets from environment variables or a secrets manager; reject startup if required secrets are absent.
- Check for goroutine leaks and unclosed response bodies, especially in HTTP client code and streaming handlers.
