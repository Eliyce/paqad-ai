---
'paqad-ai': minor
---

Per-feature evidence bundle (#339): re-key the stage-evidence spine onto one
git-ignored directory per feature. A change's plan/spec/stage evidence now live in
`.paqad/ledger/feature-evidence/<issue>-<slug>-<ULID>/`, resolved from the active
feature in the per-session control, instead of the anonymous `<session>/<ordinal>`
scheme. The recorder, live-writer, finalize, verify, fold, narration, marker-parse,
and the pre-mutation gate all key on the feature dir; new `paqad-ai stage start
--title/--issue` and `paqad-ai resume --feature <ref>` verbs open and reactivate named
features. Storage location only — the row schema, hashing, and the stage spine's
behaviour are unchanged.
