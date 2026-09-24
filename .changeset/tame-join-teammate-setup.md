---
'paqad-ai': patch
---

fix(#576): make `paqad-ai join` fully provision a teammate machine and stop the first prompt of a session from falsely blocking at Stop

- Route every prompt (including the not-yet-loaded first prompt) so a read-only turn is classified non-feature and the Stop backstop no longer blames pre-existing dirty tracked files; also capture a session-start dirty-file baseline the completion backstop subtracts, and treat `.ai/` as host-agent config.
- `join` now performs the global framework install (`~/.paqad-ai/current` + stage agents), regenerates the per-machine detection/stack-snapshot/stack-drift artifacts, builds the code-knowledge index (also on `onboard`), runs delivery detection, seeds the quality baseline from HEAD, and rebuilds the RAG index without rewriting tracked files.
- The classifier routes interrogative project questions (how/where/what/why/explain/show me/example) to `project-question`.
- Git-hook installation skips a git-tracked hooks dir and reports the snippet instead; `join` closes four small correctness gaps (dead sentinel write, framework-version epoch seed, stale host-config refresh, tracked-aware ignore check); and the load directive steers the agent to its file-read tool to avoid the zsh `=` trap.
- `doctor`'s missing-artifact remediation now points at `paqad-ai join`.
