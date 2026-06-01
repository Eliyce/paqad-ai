# Go Web Foundation

- Prefer the standard library (`net/http`, `log/slog`, `database/sql`, `encoding/json`) and well-established packages over custom scaffolding; reach for a framework only when the stdlib genuinely falls short.
- Keep handlers thin: parse and validate input, delegate to a service/domain layer, write the response and an explicit status code.
- Pass `context.Context` as the first argument of every function that does I/O or can be cancelled, and thread the request's `r.Context()` through to downstream calls.
- Keep package boundaries intentional — one package per coherent responsibility, no circular imports; put non-public packages under `internal/`.
- Always check and handle returned errors at the call site; wrap with `%w` to preserve the chain rather than dropping context.
- Set timeouts on `http.Server` (`ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`) and on outbound `http.Client`; never use the zero-value default client/server for production traffic.
