# Benchmarks

Configured in `.paqad/project-profile.yaml › intelligence.benchmark_gates`.

## RAG Quality Gates

| Metric                                  | Threshold |
| --------------------------------------- | --------- |
| Hit@5 improvement                       | ≥ 20%     |
| Task success rate improvement           | ≥ 10%     |
| Correction turn reduction               | ≥ 15%     |
| Prompt token increase limit             | ≤ 10%     |
| Prompt token override (success uplift)  | ≥ 15%     |

## Retrieval Settings

- Embedding provider: **local** (`Xenova/all-MiniLM-L6-v2`)
- Similarity threshold: `0.75`
- Top-N: `20`
- Max file size for embedding: `153600` bytes (150 KB)
- Adaptive retrieval: **on**, min useful chunks = 3
- Reranking: **off** (`backend: local`, pool size 50 when enabled)
- Metadata filters: **on**
- Action routing: **off**

## Model-Graded Eval

- Disabled (`intelligence.benchmark_eval.model_graded.enabled: false`). Enable explicitly per-run when measuring regressions.

## Test / Build Gates

- `pnpm ci` must pass: `typecheck → lint → format:check → test:coverage → build`.
- Coverage thresholds are enforced via the `run-vitest-with-summary.mjs` runner (see `scripts/`).
