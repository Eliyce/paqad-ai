# Go Web Performance

- Eliminate N+1 query patterns: do not call the database or an HTTP dependency once per loop iteration — batch with an `IN (...)` query, a join, or a single bulk call.
- Configure the `database/sql` pool explicitly (`SetMaxOpenConns`, `SetMaxIdleConns`, `SetConnMaxLifetime`) for the expected concurrency instead of relying on defaults.
- Stream or paginate large result sets (`rows.Next()` iteration, `LIMIT`/`OFFSET` or keyset pagination); do not load unbounded rows into a slice in memory.
- Reuse a single `http.Client` (it pools connections) rather than constructing one per request, and always `defer resp.Body.Close()` and drain the body so connections are reused.
- In hot paths preallocate slices/maps with a known capacity (`make([]T, 0, n)`) and reuse buffers (`sync.Pool`, `bytes.Buffer`) to cut allocations.
- Profile with `go tool pprof` (CPU/heap) and benchmark with `go test -bench` before optimizing; let evidence, not guesswork, drive changes.
