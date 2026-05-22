# Node.js Service Conventions

## Process Lifecycle

Define clear phases for your service process:

1. **Startup** — load and validate configuration, initialise connections, register signal handlers.
2. **Ready** — signal readiness after all dependencies are connected (emit a log line, write to a readiness file, or call a health endpoint).
3. **Running** — process requests, jobs, or events.
4. **Shutdown** — drain in-flight work, close connections, flush logs, exit with code `0`.

Never start accepting work before the ready phase is complete.

## Graceful Shutdown

- Register both `SIGTERM` and `SIGINT` handlers. Kubernetes sends `SIGTERM`; Ctrl-C sends `SIGINT`.
- On signal receipt: stop accepting new work, drain queues/in-flight requests, close server and database connections, then `process.exit(0)`.
- Set a shutdown timeout (e.g., 10 seconds). If graceful shutdown takes longer, force-exit and log the reason.
- Use `process.on('unhandledRejection', ...)` and `process.on('uncaughtException', ...)` to log and exit non-zero rather than silently ignoring failures.

## Health Checks

- Expose a `/health` or `/ready` HTTP endpoint even if your service is not primarily HTTP-based.
- Liveness check (`/health`): returns `200` if the process is running.
- Readiness check (`/ready`): returns `200` only if all dependencies (database, cache, external APIs) are reachable.
- Return structured JSON (`{ "status": "ok" }`) for machine parsing.

## Environment Variable Management

- Validate all required environment variables at startup. Fail fast with a clear error message listing missing variables — do not let the service start in a broken state.
- Use a typed configuration module (e.g., `zod`, `envalid`, or a hand-written validator) that maps `process.env` to a typed config object.
- Document every environment variable in a `.env.example` file committed to the repository.
- Never default to production values — default to safe local-development values.

## Logging

- Use structured JSON logging in production (e.g., `pino`). Human-readable logs in development.
- Log levels: `fatal`, `error`, `warn`, `info`, `debug`, `trace`. Default production level: `info`.
- Include a correlation ID (request ID, job ID) in every log line for traceability.
- Never log PII (passwords, tokens, credit card numbers, email addresses) at any log level.
- Log the start and end of every significant unit of work with timing information.

## Error Handling

- Distinguish between operational errors (expected: invalid input, database timeout) and programmer errors (unexpected: null dereference, type error). Only programmer errors should crash the process.
- Wrap async entry points in try/catch or use `process.on('unhandledRejection')` as a last resort, not a first resort.
- Return machine-readable error responses from HTTP endpoints (`{ "error": "...", "code": "..." }`).

## Testing Patterns

### Unit Tests

- Test business logic in pure functions isolated from I/O. Inject dependencies (database, cache, queue client) rather than importing them directly.
- Test error paths explicitly — network timeouts, database constraint violations, queue full.

### Integration Tests

- Test the full request/response cycle against a real database and real queue (use Docker Compose in CI).
- Test graceful shutdown by sending `SIGTERM` to the running process and asserting clean exit.
- Test health check endpoints return the correct status codes under normal and degraded conditions.

## Security

### Network Binding

- In development, bind to `127.0.0.1` (localhost only). In containers, bind to `0.0.0.0`.
- Never expose management or admin endpoints on the same port as the public API without authentication.

### TLS Configuration

- Terminate TLS at the load balancer or reverse proxy in production. Do not skip TLS validation (`rejectUnauthorized: false`) in any environment.
- When TLS is terminated in the service, use only TLS 1.2+ and disable weak cipher suites.

### Secret Injection

- Inject secrets via environment variables or a secrets manager (Vault, AWS Secrets Manager, Doppler). Never hardcode secrets or commit them to the repository.
- Secrets should not appear in logs, error messages, or health check responses.

### Rate Limiting

- Apply rate limiting at the service boundary for any externally reachable endpoint.
- Use a distributed rate limiter (backed by Redis) when running multiple replicas.

### Request Validation

- Validate all inbound data against a schema before processing. Reject unknown fields.
- Set request body size limits to prevent memory exhaustion attacks.
