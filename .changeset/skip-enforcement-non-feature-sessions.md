---
'paqad-ai': patch
---

Skip end-of-change enforcement and all completion checks when the session never
routed to feature-development (#499). Previously a dirty working tree (for
example a file hand-edited before the session) was swept up by the `git status`
fallback, classified as a feature-development change by file path alone, and the
in-session completion seam blocked the turn demanding planning/spec/review/checks
stages the session never owed. The completion backstop now consults the per-message
route: for a question, pentest, docs task, RCA, or small-talk session it runs no
gate, mints no inferred-git record, writes no evidence, and never blocks — it
returns an ok "verification not applicable" verdict and records one audit row.
An absent/unknown route still runs the full pass (fail-closed), and a session that
recorded any agent-authored code edit re-arms full enforcement. The git/CI
backstop and the pre-mutation gates are unchanged.
