---
'paqad-ai': patch
---

Evidence-in-bundle cutover, Phase A (#468): add additive per-feature bundle writers for duplication counts (`duplication.jsonl`), change-metrics ratios (`change-metrics.jsonl`), and the graded gate rows (`evidence.jsonl`), plus their whole-project projections. Every existing project/session-scoped write is left untouched — this is a dual-write parity window, not a cutover. A parity test asserts the new bundle rows agree with the old-home rows for a real feature-development change. No reader is re-pointed and no path is retired yet (Phases B and C).
