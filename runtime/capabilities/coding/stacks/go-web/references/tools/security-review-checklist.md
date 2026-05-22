# Go Web Security Review Checklist

- Validate middleware chain ordering: authentication and authorization middleware must run before handler logic.
- Check for SQL injection in raw query strings; prefer parameterized queries via `database/sql` or ORM.
- Review context propagation: confirm auth principals are passed via `context.Context`, not global state.
- Check for goroutine leaks and unclosed response bodies in HTTP client code.
- Confirm secrets are loaded from environment variables or a secrets manager; no hardcoded credentials in `config` structs.
