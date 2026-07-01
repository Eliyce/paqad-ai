---
'paqad-ai': minor
---

Make the mandatory `review` stage recordable when review happens after tests/docs (issue #270).

The stage-evidence ledger enforces a canonical stage order (`planning → specification → development → review → checks → documentation_sync`) and rejects an earlier stage that starts after a later one, so the recorded order can't be faked. `review` is the one stage this punished unfairly: it is **edit-less** (a review of the finished diff mutates no file, so the live writer can never stamp it) yet canonically **precedes** `checks` and `documentation_sync` — the stages the live writer *does* stamp from the tests and docs written during the build. An honest review of the completed change therefore lands, in wall-clock time, after those rows already exist, and the completeness gate reported it as `incomplete — missing [review]`, indistinguishable from a skipped review.

- **`review` is now a completion-anchored stage** (`COMPLETION_ANCHORED_STAGES` in `src/stage-evidence/stages.ts`): its canonical position is the completion boundary, so it is exempt from forward-ordering. The recorder no longer treats a completion-anchored start as out-of-order, the fold flags no ordering violation for a pair involving one, and the finalize seam already anchors an open review at the completion clock.
- **Honesty floor unchanged.** The exemption forgives ordering only, never absence: a review that is never marked is still `missing` → `incomplete`, so "reviewed late" stays distinct from "not reviewed". Rows remain script-minted, and the exemption is scoped to `review` alone — a genuine overlap between two non-anchored stages still flags.
- `docs/verification-enforcement.md` documents the completion-anchored ordering contract.
