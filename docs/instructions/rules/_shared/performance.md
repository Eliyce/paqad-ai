# Performance

- Measure before optimizing: base performance changes on a profile or benchmark, not a guess. <!-- @rule RL-dce5 -->
- Avoid N+1 queries and unbounded result sets; paginate, batch, and stream large work. <!-- @rule RL-3d44 -->
- Cache only with a clear invalidation story; prefer correctness over a fragile cache. <!-- @rule RL-5d76 -->
- Keep hot paths free of avoidable allocation and repeated I/O. <!-- @rule RL-a48c -->
