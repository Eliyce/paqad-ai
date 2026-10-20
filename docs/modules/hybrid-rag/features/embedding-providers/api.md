# Embedding Providers (local / openai / voyageai): API View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `embedding-providers`

No CLI verb of its own. `paqad-ai rag init`, `rag rebuild` and the background sync build providers through the factory below.

## `src/rag/providers.ts`

```ts
export function createEmbeddingProvider(
  projectRoot: string,
  intelligence: IntelligenceConfig,
  onProgress?: (update: ProviderProgressUpdate) => void,
): Promise<EmbeddingProvider>;

export class LocalEmbeddingProvider implements EmbeddingProvider {}
export class OpenAiEmbeddingProvider implements EmbeddingProvider {}
export class VoyageEmbeddingProvider implements EmbeddingProvider {}

export function localModelsRoot(): string;
export function localModelDir(model: string): string;
```

`intelligence.embedding_provider` picks the class: `openai`, `voyageai`, or `local` (also the fallback for any other value). Every provider has the same shape (`src/rag/types.ts`):

```ts
interface EmbeddingProvider {
  readonly name: 'local' | 'openai' | 'voyageai';
  readonly model: string;
  validate(): Promise<void>;
  embed(input: string | string[]): Promise<number[][]>;
}
```

`localModelsRoot()` is `~/.paqad/models` and `localModelDir(model)` is `~/.paqad/models/<model>`. The local provider loads from there, and `RagService.localModelCached(model?)` checks the same folder, so `paqad-ai doctor` and the loader always agree.

## `src/core/optional-package.ts`

```ts
export function describeOptionalEngine(env?: NodeJS.ProcessEnv): {
  state: 'ready' | 'installing' | 'install failed' | 'not installed';
  detail?: string;
  hint?: string;
};

export function maybeStartOptionalEngineInstall(
  env?: NodeJS.ProcessEnv,
  deps?: EngineInstallDeps,
  options?: { projectRoot?: string },
): 'started' | 'already-present' | 'in-progress' | 'throttled' | 'no-plugin-data' | 'no-pinned-range';

export const ENGINE_INSTALL_NETWORK_HINT: string;
```

`maybeStartOptionalEngineInstall` installs `@huggingface/transformers` into `CLAUDE_PLUGIN_DATA` in a detached process. With no `CLAUDE_PLUGIN_DATA` it returns `no-plugin-data` and starts nothing. An attempt within the retry interval returns `throttled`, and an install still running returns `in-progress`. Given `projectRoot`, the installer runs `paqad-ai rag rebuild --project-root <root>` after a successful install.
