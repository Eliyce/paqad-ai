# Rust Web Performance

- Watch for blocking calls (`std::thread::sleep`, synchronous I/O) inside async handlers; use async equivalents or `spawn_blocking`.
- Prefer streaming or pagination over collecting unbounded query results into a `Vec` in memory.
- Avoid cloning large data structures in hot paths; prefer `Arc` for shared read-only state.
- Use `tower` middleware for response compression and connection pooling rather than per-handler workarounds.
- Prefer fixes backed by `cargo bench` or profiling evidence rather than speculative optimization.
