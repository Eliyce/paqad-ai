# Express Conventions

- Mount routes on `express.Router()` instances grouped by resource; keep handlers thin and push business logic into service modules, not into route callbacks.
- Validate and coerce every `req.body`, `req.params`, and `req.query` with a schema (`zod`, `joi`, or `express-validator`) before use; never pass raw request input to a database query.
- Use parameterized queries / an ORM (Prisma, Knex, Sequelize) for all SQL; never build queries by string-concatenating request values.
- Define an error-handling middleware with the four-arg signature `(err, req, res, next)` registered last, and forward errors via `next(err)`; wrap async handlers so rejected promises reach it (Express 5 forwards them automatically, Express 4 needs a wrapper like `express-async-handler`).
- Set security headers with `helmet`, enable CORS explicitly with the `cors` package (allowlist origins — do not reflect `*` with credentials), and apply `express-rate-limit` on auth and write endpoints.
- Read configuration and secrets from `process.env` (validated at startup); never hardcode credentials or commit `.env`.
- Register body parsers (`express.json()`, `express.urlencoded()`) with explicit size limits to bound request payloads.
- Implement authentication/authorization as middleware applied per-router or per-route; check authorization on every protected route, not just at login.
- Return correct status codes and a consistent JSON error shape (`{ error, code }`); do not leak stack traces or internal messages to clients in production.
- Order middleware deliberately — parsers and auth before route handlers, error handler last; mounting order is execution order.
- Serve only intended static directories with `express.static`, and resolve user-supplied file paths against a base dir to prevent path traversal.
