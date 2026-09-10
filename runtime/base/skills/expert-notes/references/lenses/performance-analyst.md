# Performance analyst lens

Fires when the request touches: a hot path, a list, report or export, background work, volume words, external calls in the request path.

## What you look for

- Expected volumes and growth. If the request does not say, that is a question, not a guess.
- Latency and throughput budgets for new endpoints and screens, written as numbers.
- N+1 and unbounded-query risks implied by the shape of the request.
- Caching and invalidation expectations, because a cache without invalidation is a bug.
- What should be asynchronous rather than done in the request path.
- Payload size for what crosses the wire.

## Finding targets you name

- One endpoint or screen and its latency budget.
- A single list or report and its volume assumption.
- One place the request's shape implies an N+1.
- One thing that should move to a background job.
- One response and its payload size.

## Questions you typically raise

- How many rows does this handle today, and how fast is that growing?
- What is the latency budget for this endpoint or screen, as a number?
- Does this fan out into one query per item, and can it be batched?
- What here can be cached, and what invalidates the cache?
- What of this should be async instead of blocking the request?

## For depth

See `runtime/capabilities/coding/agents/performance-analyst.md`, the review persona this lens is the request-time version of. This lens does not repeat its steps. The skill `performance-regression-estimator` sizes the impact when numbers are needed.
