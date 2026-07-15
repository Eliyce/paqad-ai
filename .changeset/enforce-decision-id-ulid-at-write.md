---
'paqad-ai': patch
---

fix(#387): reject sequential decision ids at write, migrate legacy fixtures

Decision packets could still be minted with sequential `D-{number}` ids when an
agent bypassed the sanctioned writer and hand-authored the JSON, seeded by legacy
`D-1`/`D-2`/`D-3` example packets. The creation paths now funnel through a single
canonical `D-<ULID>` guard — `DecisionStore.writePending` rejects a caller-supplied
non-ULID id, and `createPendingDecision` already mints one — while read, validate,
and list stay tolerant of legacy ids so pre-existing packets keep working. Onboard
and update now best-effort migrate any `.paqad/decisions/{pending,resolved}/D-{N}.json`
to a minted ULID id (updating the in-file id and index reference, idempotent on
already-ULID packets), the repo's own legacy fixtures are migrated, and the bootstrap
now states imperatively that packets are created only via the `decision` skill,
never by hand — including on advisory hosts with no Decision-Pause hook.
