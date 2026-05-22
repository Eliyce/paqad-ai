# Go Web Performance

- Watch for N+1 query patterns in loops that call database or HTTP dependencies per iteration.
- Use connection pooling settings appropriate for the expected concurrency; document the chosen values.
- Prefer streaming or pagination over loading unbounded result sets into memory.
- Avoid unnecessary allocations in hot paths; profile with `go tool pprof` before speculative optimization.
- Prefer fixes backed by benchmark or profiling evidence rather than guesswork.
