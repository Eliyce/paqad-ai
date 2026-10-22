# Embedding Providers (local / openai) — Technical View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `embedding-providers`

## Module Boundaries

Source directories owned by this feature:

- `src/rag`
- `src/project-knowledge`



## Entry Points

- Imported by other paqad-ai modules — see the source list above for the public surface.

## Providers

- The providers are `local` and `openai`. `createEmbeddingProvider` in `src/rag/providers.ts`
  builds the `openai` provider for `openai` and the local provider otherwise.
- The local provider needs `@huggingface/transformers` v4 (`^4.3.1`). Both transformers
  pipelines, feature-extraction in the local provider and text-classification in the reranker
  (`src/context/reranker.ts`), keep the `dtype: 'q8'` pin, so the default MiniLM embeddings
  stay the same and existing indexes under `.paqad/vectors/` stay valid.
- The OpenAI provider reads `OPENAI_API_KEY` from the environment or `.paqad/secrets.env`.
- A saved `voyageai` value is refused with the removal message from
  `src/rag/removed-provider.ts`. The value can come from `rag_embedding_provider` in the config
  file, from `PAQAD_RAG_EMBEDDING_PROVIDER`, or from `intelligence.embedding_provider` in the
  project profile. The refusal comes before any network call, model download or index write,
  and paqad never falls back to the local provider. The message names `local` and `openai`, the
  `rag_embedding_provider` setting and `paqad-ai rag init --provider local`. Hook-driven context
  loading reports the same message as a warning and loads no RAG context.

## Data Model / Schema

- Tables, JSON schemas, or YAML schemas owned by this feature.
- For `framework-internals` modules, this usually means the file shape under `.paqad/` or
  the validated input/output contract.

### Local embedding models (RAG buildout F23)

- `LOCAL_EMBEDDING_MODELS` (`src/core/project-intelligence.ts`) is the curated set of
  selectable local (transformers.js) models. Each runs fully offline after a one-time
  shared download under `~/.paqad/models`.
- **MiniLM (`Xenova/all-MiniLM-L6-v2`) is the default FLOOR** — `getDefaultEmbeddingModel('local')`
  and `DEFAULT_LOCAL_EMBEDDING_MODEL` both resolve to it.
- A **code-tuned** model (`Xenova/jina-embeddings-v2-base-code`) is the opt-in upgrade for
  stronger code retrieval offline.
  `isCodeTunedLocalModel(id)` reports membership.
- The list is a curated, supported subset, not a hard limit — the local provider
  downloads any transformers.js feature-extraction model. The code-tuned model is opt-in
  and must clear the F15 eval gate before it is recommended; MiniLM stays the default.
- The `rag` setup flow (`src/cli/commands/rag.ts`, `resolveLocalModel`) offers the picker
  interactively (defaulting to MiniLM); non-interactive runs keep the floor.

### Where the local model lives

- `localModelsRoot()` and `localModelDir(model)` in `src/rag/providers.ts` are the one place
  that names the cache folder (`~/.paqad/models/<model>`). The local provider loads from it and
  `RagService.localModelCached` checks it, so `paqad-ai doctor` and the loader never disagree.
- doctor resolves the model the way the provider does: the configured `embedding_model`, else
  `getDefaultEmbeddingModel('local')`.

### Background engine install in the plugin

- The plugin ships no `node_modules`, so `@huggingface/transformers` is installed on demand
  into `CLAUDE_PLUGIN_DATA` by `maybeStartOptionalEngineInstall` in
  `src/core/optional-package.ts`. It only starts when `CLAUDE_PLUGIN_DATA` is set. The plugin
  CLI wrapper (`runtime/claude-plugin/bin/paqad-ai` and `paqad-ai.cmd`) sets it to
  `${CLAUDE_CONFIG_DIR:-~/.claude}/plugins/data/paqad-eliyce` when it is missing, because the
  agent's shell does not carry it.
- Given a project root (`{ projectRoot }`, the third argument), the detached installer runs
  `paqad-ai rag rebuild --project-root <root>` after a successful install, so the index the
  onboarding could not build gets built once the engine is there. The rebuild output goes to
  the same install log.
- The install marker records the specs it installed. When the engine resolves from
  `CLAUDE_PLUGIN_DATA` but the recorded specs differ from the declared ones (or the marker
  recorded none), the declared specs are installed again, so an engine still on transformers v3
  is replaced. The in-progress lock and the 24-hour retry throttle still apply, and an engine
  that resolves outside `CLAUDE_PLUGIN_DATA` is left alone.

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

- Unit test files that cover `embedding-providers` directly.
- Integration tests that exercise this feature end-to-end.
- Manual verification commands (CLI invocations, agent prompts).

## Observability

- Console output / log lines emitted.
- Tracker writes (`.paqad/doc-progress.json`, `.paqad/stack-drift.json`, etc.).
- Exit codes (for CLI features).
