---
id: "TD-01M5H0JNXKCZP80ST1AW0AWTN8"
title: "Plugin engine loads now spawn an extra npm root -g per optional-package load"
kind: "debt"
severity: "low"
status: "open"
files:
  - "src/core/optional-package.ts"
found_in:
  change: "01M5FTB2H17C1WTKHNGVTZVZQJ"
  issue: "713"
  stage: null
found_by: "review"
session: "e99f1b6e-48f6-45a4-a6f4-6cfac09ea07f"
created_at: "2026-10-22T05:15:41.865Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

`loadOptionalPackage` in `src/core/optional-package.ts` now calls `maybeStartOptionalEngineInstall` after a successful load from an alternate base, so a plugin engine on old specs is replaced. In a Claude plugin install (CLAUDE_PLUGIN_DATA set) that call resolves the engine again through `resolveOptionalPackage`, whose `alternateBases` always runs `npm root -g` through `execFileSync`, even when an earlier base already resolves. Each engine load (embeddings, reranker, tokenizer) therefore pays one extra `npm` spawn per process. Outside the plugin it returns `no-plugin-data` first and costs nothing. Fix: compute the global root lazily and cache it per process, or reuse the path the load already found.
