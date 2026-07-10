# Performance

- Measure before optimizing: base performance changes on a profile or benchmark, not a guess.
- Avoid N+1 queries and unbounded result sets; paginate, batch, and stream large work.
- Cache only with a clear invalidation story; prefer correctness over a fragile cache.
- Keep hot paths free of avoidable allocation and repeated I/O.
