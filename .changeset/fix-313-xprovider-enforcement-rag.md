---
'paqad-ai': patch
---

fix(#313): cross-provider enforcement + RAG coverage from the dogfood benchmark

- **Codex stage markers no longer lost.** On `codex-cli` the completion `Stop`
  payload carries no readable `transcript_path` and its inline final message is
  marker-less, so well-behaved Codex runs recorded zero stages and were silently
  scored "blocked". The record-only hook now reads the session's own
  `~/.codex/sessions/**/rollout-*.jsonl` (honoring `CODEX_HOME`), and the marker
  parser now understands Codex's `payload`-nested rollout shape.
- **`module-docs-structure` stops over-blocking pre-existing flat docs.** A
  doc-sync that merely touched a flat `docs/modules/{module}/features/{feature}.md`
  file already established repo-wide is no longer hard-failed into a revert (same
  family as #310). A lone flat doc introduced into an otherwise-nested repo still
  fails.
- **Honest RAG host-surface coverage.** Documented that the `UserPromptSubmit`
  retrieval seam only runs where the host executes that hook; the JetBrains Claude
  surface did not in the benchmark, so retrieval degrades to grep/read there.
