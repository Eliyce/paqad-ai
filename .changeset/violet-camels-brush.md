---
'paqad-ai': patch
---

fix(#403): back-fill the generic `change-<ULID>` bundle slug from the plan title. When `plan compile` writes a titled plan into a feature whose dir was minted by a bare `paqad:stage planning start`, the bundle is renamed to its descriptive `[<issue>-]<slug>-<ULID>` name — same ULID, every `_session` control repointed, stage-evidence artifact paths rewritten and re-stamped. The feature-development rule pack now tells the agent to include the change title in the plan template.
