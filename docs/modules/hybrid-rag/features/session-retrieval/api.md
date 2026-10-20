# Session Retrieval: API View

> Module: **Hybrid RAG Runtime** (`hybrid-rag`) · Layer: `framework-internals` · Feature slug: `session-retrieval`

## CLI

```
paqad-ai rag refresh-context [--project-root <path>] [--quiet] [--session <id>]
paqad-ai rag probe <query> [--project-root <path>] [--top-n <n>]
```

`rag refresh-context` is what the background trigger runs on each prompt (with `--quiet`). It recomposes `.paqad/context/session-context.md` for the route of the session named by `--session`: the rule sections and existing surface when the route loads rules, and, with RAG on, a synced index and the `## Retrieved context` section. The retrieval is recorded in the RAG evidence ledger. With RAG off it composes the rule sections only.

`rag probe` prints the scores of the top candidates before the confidence floor is applied (default 10), so you can see why a query injected nothing.

## `src/context/retrieval-context.ts`

```ts
export interface RetrievalSlice {
  source_file: string;
  content: string;
  score?: number;
  lowConfidence?: boolean;
}

export interface GatherOptions {
  service?: RetrievalSource;
  changedPaths?: readonly string[];
  topN?: number;
  scope?: 'docs' | 'code' | 'all';
  routing?: DepthRoutingInput;
  recordEvidence?: { sessionId?: string; adapter?: string };
  query?: string;
}

export function gatherWorkingSetSlices(
  projectRoot: string,
  options?: GatherOptions,
): Promise<{ slices: RetrievalSlice[]; bestScore: number | null }>;

export function composeRetrievalSection(
  slices: readonly RetrievalSlice[],
  opts?: { bestScore?: number | null },
): string;

export const MAX_RETRIEVAL_SLICES = 5;
export const MAX_SLICE_CHARS = 1200;
export function isDocScopedPath(path: string): boolean;
export function scopeForWorkflow(workflow?: ClassificationWorkflow | null): 'docs' | 'code' | 'all';
export function filterToScope(slices: RetrievalSlice[], scope: 'docs' | 'code' | 'all'): RetrievalSlice[];
export function dedupeSlices(slices: readonly RetrievalSlice[]): RetrievalSlice[];
export function deriveScopeFromWorkingSet(paths: readonly string[]): ClassificationScope;
```

With no changed files and no query, `gatherWorkingSetSlices` returns no slices and `bestScore: null` without touching the index. `changedPaths` defaults to the change evidence.

`composeRetrievalSection` renders at most 5 slices, each cut at 1200 characters. With no slices it renders one line naming the best match below the floor when `bestScore` is known, and `''` when it is not. A result made of weak matches gets a heading and guidance that say so.

## `src/context/retrieval-depth-router.ts`

```ts
export function gateRetrieval(input: DepthRoutingInput & { baseTopN: number }): {
  depth: 'none' | 'standard' | 'deep';
  topN: number;
  skip: boolean;
};
export function selectRetrievalDepth(input: DepthRoutingInput): 'none' | 'standard' | 'deep';
export function escalateDepth(depth: RetrievalDepth): RetrievalDepth;
export function topNForDepth(depth: RetrievalDepth, baseTopN: number): number;
```

`none` gives a `topN` of 0 and `skip: true`, `standard` keeps `baseTopN`, and `deep` triples it. A trivial single-file change, or a trivial or low investigation, is `none`. A high or very high complexity, a system-wide scope or a high risk is `deep`.
