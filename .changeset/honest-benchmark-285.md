---
'paqad-ai': minor
---

Publish two measured, reproducible benchmark numbers with methodology and caveats
(issue #285). Adds read-only repo tooling: `scripts/measure-footprint.mjs` reports the
resident session-start token footprint per area (real tokenizer via
`src/context/tokenizer-cache.ts`, labelled char/4 fallback), and
`scripts/rule-findings-stats.mjs` reads the existing `rule-evidence` ledger via
`readProjectEvents` and buckets deterministic findings by ISO week. Results, method, run
counts, tokenizer version, per-tier applicability, and caveats live in
`docs/instructions/benchmarks/measured.md`. The two unbenchmarked "60-85%" README claims
are replaced with the measured 49-61% resident-load reduction and a link to the method.
No product behavior changes; `rag_enabled` stays default off.
