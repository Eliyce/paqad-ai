# Performance

- Measure before optimizing: base performance changes on a profile or benchmark, not a guess. <!-- @rule RL-dce5 -->
- Cache only with a clear invalidation story; prefer correctness over a fragile cache. <!-- @rule RL-5d76 -->
- Keep hot paths free of avoidable allocation and repeated I/O. <!-- @rule RL-a48c -->
