---
'paqad-ai': patch
---

fix(#401): spec freeze now runs the spec-quality review it always claimed to require

`paqad-ai spec freeze` told you, in both the rule pack and the workflow contract, that
freezing enforces "no critical spec-review defects". It never did: the CLI evaluated the
freeze with no review attached, so that clause was enforced nowhere. Agents closed the gap by
hand-running `compliance review`, which left a stray `.paqad/compliance/<slug>/spec-review.json`
behind that was neither part of the change's evidence bundle nor git-ignored.

Freeze now runs the review itself and blocks on a critical defect like any other blocker, so
there is no second command to run and no stray artifact. On a clean freeze the defect summary
is folded into the bundle's `specification.json`, so the review evidence travels with the spec
of record. Non-critical findings never block.

Two related fixes: `spec freeze` and `compliance review` now reject a spec file that resolves
outside the project root and record `spec_file` as a project-relative posix path, and the
managed `.paqad/.gitignore` covers `compliance/` so a compliance artifact can never surface as
an untracked, committable file.
