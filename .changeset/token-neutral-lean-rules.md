---
'paqad-ai': minor
---

Token-neutral by default: lean rule loading is now the default delivery path (issue #284).

A new `lean_rules` flag (default **on**, env `PAQAD_LEAN_RULES`) makes the always-resident rule manifest plus trigger-loaded applicable rule text the default, instead of loading the whole `docs/instructions/rules` tree every session. The framework bootstrap and the Claude Code prompt-gate now read `.paqad/context/session-context.md` artifact-first, falling back to the full rule load only when the artifact is missing. On Claude Code the session-time seam and the background refresh trigger are ungated from `rag_enabled` so the rule slice is injected and kept current with no embedding, index, or provider call on the lean path; `rag_enabled` continues to govern only what retrieval/memory/drift sections compose into the same artifact. A committed resident-footprint budget test and a `paqad-ai doctor` readout gate the token cost. `lean_rules=false` restores the previous full-load behaviour exactly, and paqad-disabled stays a pure no-op.
