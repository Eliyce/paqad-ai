# Rust Web Performance

- Never block the async runtime: no `std::thread::sleep`, synchronous file/network I/O, or CPU-bound loops inside an async fn — use Tokio's async APIs or move the work to `tokio::task::spawn_blocking`.
- Stream or paginate large result sets (`sqlx` `fetch` stream, `LIMIT`/keyset pagination) instead of collecting unbounded rows into a `Vec` in memory.
- Avoid cloning large data in hot paths; share read-only data with `Arc` and pass borrows (`&T`) rather than owned copies through call chains.
- Apply response compression and other cross-cutting work with `tower-http` layers (`CompressionLayer`) rather than per-handler workarounds, and reuse pooled connections (`sqlx::Pool`, a shared `reqwest::Client`) instead of opening one per request.
- Profile and benchmark before optimizing — use `cargo bench` (e.g. `criterion`) or a profiler — and let evidence, not guesswork, drive changes.
