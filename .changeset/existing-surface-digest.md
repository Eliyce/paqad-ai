---
'paqad-ai': minor
---

Planning now sees the codebase: on the feature-development route, the background context
worker composes a token-capped `## Existing surface` section into the session-context
artifact. It lists the exported symbols that already exist for the files/modules the prompt
and working set implicate — as signature cards (`name(signature) — file:line · called from N
places · module`) ranked by the repo-map's structural importance (PageRank) — so the model
reuses what exists instead of rewriting it. Signatures and caller counts come from the
code-knowledge index when present, falling back to name-only cards otherwise. The section is
budget-capped (config `existing_surface_tokens`, default 1000) with an honest truncation
line, appears only for feature-development (every other route stays token-neutral), and rides
the existing artifact so Codex/Gemini/advisory hosts get it through the same file. This gives
the built-but-unconsumed repo-map its first live consumer.
