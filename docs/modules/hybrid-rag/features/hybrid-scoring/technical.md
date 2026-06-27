# Hybrid Scoring — Technical View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `hybrid-scoring`

## Module Boundaries

Source directories owned by this feature:

- `src/rag`
- `src/project-knowledge`



## Entry Points

- Imported by other paqad-ai modules — see the source list above for the public surface.
- BM25 + RRF fusion (RAG buildout F17): `src/rag/lexical-bm25.ts` (`Bm25Index`,
  `tokenize` — camelCase/snake_case/dotted splitting so identifiers and prose share
  terms) + `src/rag/rrf-fusion.ts` (`reciprocalRankFusion`, k=60). `RagService.retrieve`
  over-fetches a dense pool (`limit * 4`), builds a BM25 ranking over those candidates,
  and RRF-fuses the two before trimming to `limit`. This recovers exact-identifier
  chunks that cosine ranked just outside the cut. Safe by construction: cosine scores
  are preserved, so the F12 precision floor and the below-threshold fallback are
  unchanged — fusion only reorders/recalls within the floor-passing set, never injects
  a below-floor chunk and never increases the injected token cap. A purely-semantic
  query with no lexical overlap leaves the dense order untouched. Eval-gated (F15).

## Data Model / Schema

- Tables, JSON schemas, or YAML schemas owned by this feature.
- For `framework-internals` modules, this usually means the file shape under `.paqad/` or
  the validated input/output contract.

## API / Interface Contract

- Public functions exported from the source files above.
- CLI flags / arguments (if applicable).
- Agent-callable skill names or workflow trigger phrases (if applicable).

## State Management

- What state this feature reads.
- What state this feature writes.
- Where that state is persisted (`.paqad/**`, project files, in-memory only).

## Error Codes

- Structured error IDs emitted by this feature.
- Mapping from error ID → user-facing message → recovery action.

## Dependencies

- **Internal:** other paqad-ai modules this feature imports or calls.
- **External:** npm packages, system binaries (`node`, `git`, etc.).
- **Runtime data:** files that must already exist before this feature runs.

## Configuration

- Environment variables read.
- Config keys in `.paqad/project-profile.yaml` or `.paqad/onboarding-manifest.json`.
- Default values and override precedence.

## Testing Entry Points

- Unit test files that cover `hybrid-scoring` directly.
- Integration tests that exercise this feature end-to-end.
- Manual verification commands (CLI invocations, agent prompts).

## Observability

- Console output / log lines emitted.
- Tracker writes (`.paqad/doc-progress.json`, `.paqad/stack-drift.json`, etc.).
- Exit codes (for CLI features).
