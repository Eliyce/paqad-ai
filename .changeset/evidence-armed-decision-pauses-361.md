---
'paqad-ai': minor
---

Arm the create-vs-reuse decision pause from evidence instead of the agent's
honesty (#361).

The `create-vs-reuse` pause used to fire only when the model volunteered that
it was at a reuse fork, and the packet's `callers` / `similarity` evidence
fields were computed by nothing. Now the framework mints that packet itself,
with the proof filled in, on two deterministic triggers:

- **Plan time:** at `plan compile`, each declared `new_constructs[]` entry is
  scored against the code-knowledge index (#353). A name/spec similarity at or
  above `decision_arm_plan_threshold` (default 0.85) opens a `create-vs-reuse`
  packet whose reuse option carries `{ file, last_modified, callers, similarity }`
  and whose create-new option carries the plan's own justification. The
  recommendation is reuse once the existing symbol has at least three callers.
- **Change time:** a blocking-band duplication finding (#358) opens the same
  packet from the finding, through one shared minter.

Both mints go through `paqad-ai decision create` (never hand-authored JSON),
carry `origin: "evidence-armed"`, and honour a `decision_arm_max_per_change`
cap (default 1 — only the strongest fork is asked; the rest surface as warnings).
An identical fork already answered under `.paqad/decisions/resolved/`
auto-applies that prior answer instead of re-asking and records
`reused_decision:<id>`. The `ContractDecisionOption` shape gains an optional
`evidence` field (additive, backward-compatible) so the pause gate and existing
packets are unaffected.

Governed by `decision_arm_mode` (off | warn | strict, team value is a floor):
`warn` (default) reports the fork without minting; `strict` opens the blocking
pause; `off` is identical to prior behavior. With the code-knowledge index
absent, plan-time arming no-ops silently.
