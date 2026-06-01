# Laravel Performance

- Eliminate N+1 queries: eager-load with `->with(...)` any relation accessed in a loop, Blade `@foreach`, or API Resource. Aggregate with `->withCount()`/`->withSum()` instead of counting/summing loaded collections.
- Select only needed columns on hot queries (`->select(['id', 'title'])`); avoid `SELECT *` for wide tables, and add a covering index for the columns filtered and ordered on.
- Process large datasets with `->chunkById()`, `->lazy()`, or `->cursor()` instead of `->get()`; the first two keep memory bounded, `cursor()` streams one model at a time.
- Move slow or external work (emails, third-party calls, exports) into queued Jobs (`ShouldQueue`); do not run it inline in the request lifecycle.
- Batch external work with `Bus::batch()` and avoid per-row queries inside job loops; prefer bulk `insert()`/`upsert()` over looping `create()` for large writes.
- Cache expensive, stable computations with `Cache::remember($key, $ttl, fn () => ...)`; pick a tagged or versioned key so you can invalidate on writes, and do not cache per-request user-specific data with a shared key.
- Use `config:cache`, `route:cache`, `event:cache`, and `view:cache` in production deploys; ensure no `env()` calls live outside `config/` so config caching is safe.
- Back any "optimization" with a before/after measurement (query count via `DB::enableQueryLog()` / Telescope / Debugbar, or timing); do not micro-optimize without evidence of a hot path.
