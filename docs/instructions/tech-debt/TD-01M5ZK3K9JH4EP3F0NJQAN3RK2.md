---
id: "TD-01M5ZK3K9JH4EP3F0NJQAN3RK2"
title: "A failed local embedding model load surfaces as a raw Error, not EmbeddingProviderError, and skips the partial-model cleanup"
kind: "bug"
severity: "low"
status: "open"
files:
  - "src/rag/providers.ts"
found_in:
  change: "01M5YZPHCJ89TVAMWFJYS19CJ0"
  issue: "756"
  stage: "documentation_sync"
found_by: "paqad-review"
session: "924099c9-ba6b-48aa-8fc2-867026e90f4d"
created_at: "2026-10-27T21:08:52.644Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

`LocalEmbeddingProvider.loadExtractor` (src/rag/providers.ts:173) does `return pipeline(...)` inside
its `try` without `await`. When the model load rejects, the rejection skips the `catch`, so:

- the caller gets the raw Error from @huggingface/transformers, not an `EmbeddingProviderError` with
  code `download_failed`, and
- the cleanup `rm(modelPath, { recursive: true, force: true })` never runs, leaving a partial model
  directory under ~/.paqad/models that later loads treat as cached (`allowRemoteModels = !cached`).

Older than change 01M5YZPHCJ89TVAMWFJYS19CJ0 (origin/main has the same line). Found while reviewing
the per-process provider cache, which does drop a failed provider from the cache correctly.

## Fix

`return await pipeline(...)` (or assign then return) so the catch sees the rejection, and add a test
where the pipeline rejects that asserts an EmbeddingProviderError and that the model directory was
removed.
