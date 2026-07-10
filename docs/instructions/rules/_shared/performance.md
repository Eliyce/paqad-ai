# Performance

Baseline performance rules for every change, in every stack. These always load.

<!-- trigger: ** -->

- Base a performance change on a profile or benchmark, not a hunch. SHOULD measure before and after, and keep the number that justified it.
- Paginate, batch, or stream any query or result set that grows with input. MUST NOT issue one query per row (the N+1 pattern) or load an unbounded set into memory.
- Add a cache only when you can state how it is invalidated. When the cache and its source can disagree, prefer correctness over the cache.
- Keep hot paths free of avoidable allocation and repeated I/O: hoist constant work out of loops and reuse buffers and clients.

## Verify

```bash
# N+1 smell — a query/fetch inside a loop (review each hit, not a proof):
git grep -nE '\b(for|forEach|\.map)\b' -A3 -- '*.ts' '*.tsx' | grep -iE '(query|findOne|select|await .*\.(get|find|fetch))'
# A perf-motivated change carries before/after numbers (manual review).
```
