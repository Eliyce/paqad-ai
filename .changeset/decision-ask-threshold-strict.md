---
'paqad-ai': minor
---

Decision Pause: default `decisions_ask_threshold` to `strict` (humans decide; the machine does not auto-resolve mid-confidence packets).

Previously the default was `balanced` (0.85), which let the resolver auto-resolve any decision packet whose recommendation cleared 0.85 confidence. The default is now `strict` (0.95): packets in the 0.85–0.94 confidence band surface to a human instead of resolving silently. Projects that never set the key resolve to `strict`, and fresh `paqad-ai onboard` writes `ask_threshold: strict`.

This is a behaviour change on update. Teams that prefer auto-resolution can opt back in by setting `decisions_ask_threshold=balanced` (or `permissive`) in `.paqad/configs/.config.policy` / local `.config`, or via the `PAQAD_DECISIONS_ASK_THRESHOLD` env var. Applies uniformly across all providers (core/config, not entry-file behaviour).
