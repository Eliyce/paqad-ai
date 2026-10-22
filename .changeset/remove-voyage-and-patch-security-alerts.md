---
'paqad-ai': minor
---

Security fixes for the packages paqad-ai installs, and the Voyage embedding provider is removed.

- The local search engine now uses `@huggingface/transformers` v4 (still pinned to the q8 model, so existing indexes keep working), and `fast-uri` moves to a patched release. Installing this version picks up every fix for the shipped packages.
- The Voyage embedding provider is removed. If your project still has `voyageai` saved as its embedding provider (in `rag_embedding_provider`, `PAQAD_RAG_EMBEDDING_PROVIDER` or the project profile), RAG now stops with a message instead of guessing. Switch to `local` or `openai`, for example with `paqad-ai rag init --provider local`, and the index is rebuilt for the new provider. The `voyageai` package is no longer needed, so you can uninstall it, and a saved `VOYAGE_API_KEY` is no longer read.
- Claude plugin users get their local search engine upgraded automatically the next time paqad runs.
- CI now runs `pnpm audit --prod --audit-level high`. The braces advisory GHSA-vfj7-8cjw-p6xm has no patched release, so the audit ignores that one advisory by its id. Reason: braces is only reached through fast-glob, and paqad expands only glob patterns that come from its own code and shipped stack packs, plus one set built from the project's own files: code-knowledge entry points read from the project's `package.json` `main`, `bin` and `exports`. Source roots for the module map and traceability come from the shipped stack packs, and the compliance check's test globs are passed in by paqad's own callers. No pattern comes from network input, and `.gitignore` and other ignore files are matched by paqad's own ignore rules, not expanded by fast-glob. The advisory needs an attacker-controlled pattern, so the dismissal holds only while that stays true.
