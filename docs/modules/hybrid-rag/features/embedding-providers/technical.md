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
- The local provider needs `@huggingface/transformers` v4 (`^4.3.1` on the npm route; the plugin
  installs the exact version it was built with). Both transformers
  pipelines, feature-extraction in the local provider and text-classification in the reranker
  (`src/context/reranker.ts`), keep the `dtype: 'q8'` pin, so the default MiniLM embeddings
  stay the same and existing indexes under `.paqad/vectors/` stay valid.
- The OpenAI provider reads `OPENAI_API_KEY` from the environment or `.paqad/secrets.env`.
- Provider cache. Once `enableEmbeddingProviderCache()` has run, `createEmbeddingProvider`
  returns one local provider per process for each key of provider, model id, dtype (`q8`) and
  models directory, so a command loads the model once. Only the real CLI process
  (`src/cli/index.ts`, when run from the command line) turns it on; hook processes and
  imported library code never do. A provider asked for with a progress callback is built fresh
  and not cached. A provider whose model failed to load is dropped from the cache, and its own
  next `embed` tries the load again. `resetEmbeddingProviderCache()` clears the cache and turns
  it off, for tests.
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
- Versions. `readEngineSpecs` takes them from `paqadEngines` in the plugin's generated
  `package.json`, at exact `x.y.z` values. A range, tag, URL, `file:` value, two-part version or
  prerelease is refused. Any refused or incomplete `paqadEngines` gives no specs and the outcome
  `no-pinned-range`, never a range. The `dependencies` ranges apply only when `paqadEngines` is
  absent, which is the npm route.
- Upgrades. A marker holding older range specs no longer matches the exact specs, so the engines
  reinstall once in the background on a later RAG use, and again whenever a release changes a
  pinned version. A marker younger than the 24-hour retry interval returns `throttled`, so an
  upgrader can keep running the older engine until the interval passes. A rollback triggers the
  same one reinstall.
- The installer. `spawnEngineInstall` starts `runtime/scripts/install-engine.mjs` with
  `process.execPath`. The script runs `npm install <specs> --no-audit --no-fund --omit=dev
  --save-exact` in `CLAUDE_PLUGIN_DATA`, never in the user's project, so a project `.npmrc`
  cannot redirect the registry. The npm child does not get `OPENAI_API_KEY`, `COHERE_API_KEY` or
  their `CLAUDE_PLUGIN_OPTION_` forms, matched in any case. Downloaded packages' setup programs
  stay allowed.
- Windows. `npmInvocation` starts npm as `node npm-cli.js`, with no shell and no `.cmd` file,
  because Node refuses to start a `.cmd` file without a shell. It tries `npm_execpath` when that
  is absolute, named `npm-cli.js` and present, then `node_modules/npm/bin/npm-cli.js` beside node,
  then the same path beside the first absolute `PATH` entry holding `npm.cmd`. Off Windows it
  runs `npm`.
- Failures. None leaves a lock behind:
  - npm exits non-zero, the registry is unreachable or npm cannot start: the error's first line
    goes to `.paqad-engine-install.log` and the failed marker, no rebuild starts, and a later RAG
    use tries again under the 24-hour limit. On Windows with no npm the error is `npm was not
    found: no npm-cli.js beside node or on PATH.`
  - The log cannot be written: the failed marker is still written.
  - The install script is missing: `maybeStartOptionalEngineInstall` appends one line naming the
    path to the log and returns `install-script-missing`, before it writes a lock or marker, so a
    later call never reads as `in-progress`. A damaged tree adds one log line per attempt.
  - `rag rebuild` fails after a good install: the log says so and the marker stays `ready`.
- The manual hint. `engineInstallNetworkHint(env)`, used by `describeOptionalEngine` and
  `paqad-ai doctor`, prints `npm install` with the pinned specs and `--save-exact`, to run inside
  `CLAUDE_PLUGIN_DATA`.

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
