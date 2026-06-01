# Go Web Security

- Place authentication/authorization middleware before route handlers in the chain so unauthenticated requests are rejected before any handler logic runs; do not scatter ad-hoc auth checks per handler.
- Use parameterized queries via `database/sql` placeholders (`?` / `$1`) or the ORM's binding; never build SQL by concatenating or `fmt.Sprintf`-ing user input.
- Carry request-scoped identity through `context.Context` (typed context key), not global or package-level variables that race across requests.
- Load secrets from the environment or a secrets manager and reject startup if a required secret is absent; never hard-code keys or commit them.
- Always `defer resp.Body.Close()` on HTTP client responses and ensure spawned goroutines have a cancellation/stop path, to avoid leaked connections and goroutines under load or abuse.
- Set per-request limits — `http.MaxBytesReader` on request bodies and server read timeouts — so large or slow client payloads cannot exhaust memory or connections.
- Escape output destined for HTML with `html/template` (auto-escaping), not `text/template`, to prevent injection.
