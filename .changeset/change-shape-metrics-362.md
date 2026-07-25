---
'paqad-ai': minor
---

Prove "less, better code" with per-change shape metrics (#362).

Two deterministic, diff-scoped, zero-model-token numbers are now computed for
every feature-development change:

- **duplication on new code** (`dup_new_pct`) — the % of the change's meaningful
  new lines that near-duplicate existing code, folded from the #358 duplication
  cache.
- **reuse rate** (`reuse_rate`) — cross-file calls from the change's new code
  into pre-existing, untouched files per 100 changed lines, from the #353
  code-knowledge index.

They fold over caches the completion gates already produced (no second scan) and
surface everywhere the developer already looks: one honest `change shape` line on
the end-of-change receipt, a metrics block on the feature bundle receipt, a
`change-metrics` row on the session ledger (which flows into the SIEM export), a
new **Change Shape** dashboard trend section with bands (green 0–3%, amber
3–10%, red >10%), and a new `paqad-ai metrics report` verb that prints the last N
changes offline. Either metric degrades to `n/a` when its source cache is absent.
Controlled by the `metrics_enabled` config knob (default on; respects the global
disable).
