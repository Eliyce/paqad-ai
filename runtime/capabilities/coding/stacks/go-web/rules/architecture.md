# Go Web Architecture

- Module ownership and boundaries are defined per-project in `docs/instructions/rules/module-map.yml` — treat that file as the source of truth for which package owns which directory, and do not duplicate or contradict it here.
- Keep handler, service, and repository responsibilities in distinct layers; HTTP handlers parse/validate the request and write the response, services hold business logic, repositories own data access.
- Register all routes in one place (`cmd/<app>/` or `internal/server/`); keep handler implementations in `internal/handler/` or feature packages, and keep package-private types in `internal/` so they are not importable downstream.
- Apply cross-cutting middleware (auth, logging, recovery/panic-catch, CORS) at the router level via the chosen mux (`net/http` `http.Handler` wrappers, `chi`, or `gin`), not inside individual handlers.
- Accept interfaces and return concrete types at package boundaries; define the consumer-side interface in the package that uses it, not the package that implements it.
