# Go Web Environment

- Resolve environment values through a typed config struct populated at startup, not scattered `os.Getenv` calls.
- Fail fast at startup when required configuration is missing; log the missing key and exit with a non-zero code.
- Keep development, staging, and production environment files separate and never commit secrets.
- Document any environment variable that changes routing, middleware, or external service behavior.
