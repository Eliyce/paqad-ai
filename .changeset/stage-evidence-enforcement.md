---
'paqad-ai': minor
---

Stage-evidence enforcement: a deterministic gate that fails a code change whose feature-development workflow was left incomplete.

`runRepositoryVerification` now folds the stage-evidence ledger into a `stage-evidence` verification gate, read from the ledger files on disk (never an LLM claim). It is code-change-only and scoped so it cannot break a project that has not adopted stage marking:

- Every mandatory stage recorded (`complete`/`recovered`) → pass.
- The workflow was started but left incomplete (the agent live-marked at least one stage, a mandatory stage is missing) at a local origin (`hook-completion`/`git-backstop`) → **fail**, which flips the trust verdict so the git backstop blocks the commit.
- Never marked, or running on CI (a fresh checkout has no committed local ledger) → skipped/informational. The committed-receipt path that would let CI enforce stage-completeness is deferred.

Adds `live_marked` to the stage-evidence verify result (distinguishing "started the workflow but left it incomplete" from "never marked anything"), a `scripts/se-mark.ts` helper to drive the recorder from the shell, and updates `docs/verification-enforcement.md`.
