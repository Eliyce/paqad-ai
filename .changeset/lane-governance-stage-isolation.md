---
'paqad-ai': patch
---

Fix lane governance so the stage-isolation safeguard can no longer silently disable itself and report a clean bill of health (#602).

The lane that governs the end-of-change isolation check was a first-glance guess the operator could not correct, was last-writer-wins (a small follow-up could relabel a large build "fast"), and the check only fired on a graduated/full label — so a wrong or missing label switched the check off with no signal. Now:

- **Operator override** — `paqad-ai lane set <fast|graduated|full>` records the real lane for the active change; that recorded `feature.json` lane is what the isolation check reads.
- **Monotonic lane** — the recorded lane only ever rises. A later small-fix turn can never downgrade a large build, and `lane set` refuses a downgrade rather than lowering it.
- **Unresolved is loud, not silent** — a feature-development change on a subagent-capable host whose lane never resolved, with no isolation evidence, now reads Inconclusive with a "not classified — isolation not verified" note instead of a clean green (never a hard block).
- **Bare ticket/URL** — a prompt that is essentially just a ticket reference or a link no longer sets the safety lane from its surface text; the lane is left unresolved-pending-read.
- **Honest wording** — the contract and the onboarded-project overview now describe isolation as expected-and-detected at end-of-change, not hard-enforced before the edit.
