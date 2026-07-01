---
'paqad-ai': minor
---

Capability Kernel (F1–F8): unify the five enforcement contracts under one framework-owned, versioned kernel.

- Stage-evidence, rule-scripts, decision-pause, delivery, and narration are now rows in one `CapabilityRegistry`, each with per-capability policy/record schema versions.
- Evidence consumers (the dashboard and `paqad-ai audit export` / SIEM) read the always-on #249 session-ledger; the delivery, rule-compliance, and decision stores fold onto it via a shared project-ledger helper (dual-sink — the operational files the engine needs are preserved, so they stay in lockstep).
- `audit export` now unions the session-ledger doc types into the OCSF/ECS/CEF fold-view as a new `session` event kind, graded for a SOC.
- Compat spine (D2): the bless stamps a per-capability version vector into `capability-lock.json`; an install older than the schema a project was blessed under refuses to enforce cleanly (non-blocking) rather than misread a newer format.
- Removed the dead LaneRunner/SliceExecutor orchestration engine, its 19 pipeline phases, and the `paqad-ai plan resume` CLI command (they backed the trigger-independent engine that never ran at session time).
