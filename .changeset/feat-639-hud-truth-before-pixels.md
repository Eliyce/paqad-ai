---
'paqad-ai': minor
---

The paqad HUD's groundwork: one honest record before anything is drawn (#639, Wave 1).

- **Rules match the change's own files.** paqad's own `.paqad/` files (decision packets, session markers) no longer pull a rule in, and files the session inherited dirty and never touched no longer count. `rules load` and the end-of-change check use the same list.
- **One decision packet shape.** A decision opened with `paqad-ai decision create` now shows in Approvals, is counted by the end-of-change check, and can be reused by the spec pipeline once answered. Older packets are read as before. One broken packet file no longer blocks new decisions.
- **One verdict word everywhere.** The chat receipt, `report.html` and the `paqad-ai evidence` PR comment now say the same word for the same run. An inconclusive check used to read Safe to merge in the report and Needs your attention in the PR comment; it now reads Inconclusive in all three. CI blocking is unchanged.
- **One narration format.** Every paqad line, including the route line, now starts with `**▸ paqad** ·`.
- **paqad keeps its own receipt every turn**, in `.paqad/session/hud/`, without printing anything new.
- **The HUD snapshot.** `paqad-ai status --hud` (or `--hud --format json`) shows where the change stands: route and lane with the reason, stages, the High Table as recorded, gates by strength, flags, decisions, what ships and the verdict. It is built only from paqad's own records, refreshed by the paqad commands and hooks, and never changes what a hook decides.
