---
'paqad-ai': minor
---

Cross-platform hooks, always-load entry gate, and two new evidence ledgers.

- **Always-load entry gate (#240 / Part 0):** the UserPromptSubmit gate now emits the framework-load directive first and suppresses the precomputed context block until the framework is loaded, so the "load first" instruction can never be buried. The four blocking gate hooks are ported from POSIX-only `.sh` to cross-platform `.mjs` and wired as `node "<abs>/hooks/<file>.mjs"` — no bare `~`, no `.sh`, no shebang reliance — so onboarded projects work on Windows. The per-machine host hook configs are git-ignored via a nested `.gitignore`; legacy commands are pruned on re-onboard.
- **Stage-evidence ledger (#247):** a script-written, per-code-change JSONL record proving each mandatory feature-development stage ran, in order, with a start/end datetime per stage and a derived duration, plus an end-of-change completeness gate that fires automatically at completion (verifying tracked changes, or writing an honest inferred-git backstop record for an untracked diff). Always-on and independent of the enterprise/AI-BOM flags.
- **Decision-reuse ledger:** every reuse of an already-approved decision from `.paqad/decisions/resolved/` is recorded to a git-ignored, session-scoped ledger (one record per reuse). Built on the same shared session-ledger substrate as the stage-evidence and RAG-evidence ledgers.
- Removes the redundant "Use this file as the repository entrypoint…" line from every agent entry-file template.
