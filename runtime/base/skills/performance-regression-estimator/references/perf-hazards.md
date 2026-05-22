# Performance Hazards Catalog

Common patterns the estimator looks for in proposed solutions and existing code paths affected by the change.

## Data access

- **N+1 query** — a loop that issues one query per iteration where a batch query would suffice. Watch for ORM `.find()` calls inside `for` / `forEach` / `map` over a collection of records.
- **Missing pagination** — list endpoint or query that returns all rows without `LIMIT` / cursor / page size cap. Risk grows with data volume.
- **Unindexed predicate** — `WHERE` / `findBy` on a column that is not indexed and does not have a covering composite index.
- **Cross-region read** — query against a primary database from a request handler whose latency budget is sub-100 ms when a read replica is available.

## Concurrency and async

- **Sync in async** — a blocking call (`fs.readFileSync`, `sleep`, CPU loop) inside an async request handler. Blocks the event loop or worker.
- **Awaited loop** — `for (...) { await x() }` over a collection where the calls are independent and could run in parallel via `Promise.all`.
- **Missing connection pool** — opening a new DB or HTTP connection per request.

## Caching

- **Suspicious caching** — a cache layer added without a documented invalidation rule. Caching without invalidation is technical debt that surfaces as stale-data bugs.
- **Cache-aside without negative caching** — repeated misses for a known-absent key issue full DB reads on every request.
- **Cache before correctness** — cache layer added before the underlying query is verified correct; a bug becomes much harder to diagnose once cached.

## I/O

- **Sequential network calls** — multiple independent HTTP calls awaited one after another instead of in parallel.
- **Hot-path logging** — verbose logging inside a tight loop or per-request hot path that floods the log pipeline.

## Severity

- **`high`** — pattern is on a request hot path or a scheduled bulk job; latency or cost regression is observable.
- **`medium`** — pattern exists but on a cold path (admin tool, batch job that runs once per day) or behind a feature flag.
- **`low`** — pattern is theoretically present but the data volume is bounded and small.

When in doubt prefer `medium` over `low` — the user can downgrade with explicit reasoning, but unflagged hazards are silent.
