---
'paqad-ai': patch
---

Drop the `npm warn deprecated prebuild-install@7.1.3` warning shown on `npm install -g paqad-ai`.

The warning came from the local-embeddings dependency `@xenova/transformers@2.17.2` (the last release under that scope), which pulled `sharp@^0.32` and its deprecated `prebuild-install`. Migrated to the renamed, maintained `@huggingface/transformers@^3.8.0`, which uses `sharp@^0.34` (no `prebuild-install`) and satisfies the `voyageai` peer range, so no new install warning is introduced. Model repo ids are unchanged and the pipelines pin `dtype: 'q8'`, preserving the previous quantized download size and embedding/rerank output.
