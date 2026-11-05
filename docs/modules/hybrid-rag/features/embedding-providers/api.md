# Embedding Providers (local / openai): API View

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

export function localModelsRoot(): string;
export function localModelDir(model: string): string;

export function enableEmbeddingProviderCache(): void;
export function resetEmbeddingProviderCache(): void;
```

With the cache enabled (the CLI process only), two `createEmbeddingProvider` calls for the same local model, dtype and models directory return the same instance. A call with an `onProgress` callback, an `openai` provider and a provider whose model failed to load are never cached.

`intelligence.embedding_provider` picks the class: `openai`, or `local` (also used when the value is unset). A saved `voyageai` value is refused before any class is built: `createEmbeddingProvider` throws `RemovedEmbeddingProviderError` (`src/rag/removed-provider.ts`), whose message says the Voyage embedding provider was removed and names `local` and `openai` as the choices. Every provider has the same shape (`src/rag/types.ts`):

```ts
interface EmbeddingProvider {
  readonly name: 'local' | 'openai';
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
): 'started' | 'already-present' | 'in-progress' | 'throttled' | 'no-plugin-data' | 'no-pinned-range' | 'install-script-missing';

export function engineInstallArguments(): string[];
export function engineInstallNetworkHint(env?: NodeJS.ProcessEnv): string;
export const ENGINE_INSTALL_NETWORK_HINT: string;
```

`maybeStartOptionalEngineInstall` installs `@huggingface/transformers` and `openai` into `CLAUDE_PLUGIN_DATA` in a detached process, by starting `runtime/scripts/install-engine.mjs`. With no `CLAUDE_PLUGIN_DATA` it returns `no-plugin-data` and starts nothing. An attempt within the retry interval returns `throttled`, and an install still running returns `in-progress`. Given `projectRoot`, the installer runs `paqad-ai rag rebuild --project-root <root>` after a successful install.

Versions come from `paqadEngines` in the plugin's generated `package.json`, at exact `x.y.z` values. The `dependencies` ranges apply only when `paqadEngines` is absent, which is the npm route. When `paqadEngines` is present but any value is not exact, or it is not an object, the call returns `no-pinned-range` and starts nothing. When the install script is not in the package, the call appends one line naming the path to the install log, writes no lock or marker, and returns `install-script-missing`.

`engineInstallArguments()` returns the arguments that start the script, whose path comes from the running package's own location and never from the working directory. `engineInstallNetworkHint(env)` returns the manual install command with the pinned versions and `--save-exact`; `ENGINE_INSTALL_NETWORK_HINT` is its text when no versions can be read.

## `runtime/scripts/install-engine.mjs`

```ts
export function npmInvocation(input: {
  platform: string;
  execPath: string;
  env: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
}): { command: string; args: string[] } | null;
```

A standalone script that imports only `node:` built-ins and takes all its input from the `PAQAD_ENGINE_*` variables. Importing it starts nothing. `npmInvocation` says how to start npm, and `null` means npm was not found on Windows.
