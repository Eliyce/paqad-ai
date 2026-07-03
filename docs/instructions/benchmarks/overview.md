# Benchmarks

Measured results (real numbers, methodology, and caveats) live in the sibling
[`measured.md`](./measured.md). This file holds the fixed gate thresholds.

The benchmark gates below are framework-internal defaults that live in code, not
user-configured settings. The user-tunable retrieval knobs (provider, similarity
threshold, top-N, max file size) are framework knobs set in the config layer
(`rag_embedding_provider`, `rag_similarity_threshold`, `rag_top_n`,
`rag_max_file_size`); the rest of the values here are fixed by the framework.

## RAG Quality Gates

| Metric                                  | Threshold |
| --------------------------------------- | --------- |
| Hit@5 improvement                       | ≥ 20%     |
| Task success rate improvement           | ≥ 10%     |
| Correction turn reduction               | ≥ 15%     |
| Prompt token increase limit             | ≤ 10%     |
| Prompt token override (success uplift)  | ≥ 15%     |

## Resident Rule Footprint (token-neutral by default, issue #284)

Lean rule loading is the default delivery path (`lean_rules`, default **on**): every
session carries an always-resident rule **manifest** (one capped line per rule) plus
the full text of only the rules that apply to the files in play, instead of the whole
`docs/instructions/rules` tree. The resident cost paqad adds — the manifest plus the
always-load rule text, with no files in play — is gated to a fixed byte budget.

| Metric                                     | Threshold             |
| ------------------------------------------ | --------------------- |
| Resident rule footprint (manifest + always-load) | ≤ 16,384 bytes (≈ 4K tokens @ 4 bytes/token) |

The budget is a committed constant (`LEAN_RULE_CONTEXT_BUDGET_BYTES` in
`src/context/rule-context.ts`), asserted against a representative rule fixture — not a
snapshot of any one project. `paqad-ai doctor` reports each project's actual resident
footprint against its own full rule set. Rule coverage is unchanged: every rule is on
the manifest, script-enforced rules fire whether or not their text is loaded, and a
missing artifact falls back to loading the full rule tree.

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

- Disabled by default (a framework-internal gate). Enable explicitly per-run when measuring regressions.

## Test / Build Gates

- `pnpm ci` must pass: `typecheck → lint → format:check → test:coverage → build`.
- Coverage thresholds are enforced via the `run-vitest-with-summary.mjs` runner (see `scripts/`).
