# Existing-Surface Planning Digest — API View

> Module: **Context Intelligence** (`context-intelligence`) · Layer: `framework-internals` · Feature slug: `existing-surface`

This feature exposes no HTTP/CLI endpoint of its own. Its "API" is the internal
composer surface (`src/context/existing-surface.ts`) and the config knob that bounds it.
It is invoked by the background worker `paqad-ai rag refresh-context`; there is no
user-facing command to run it directly.

## Functions

### `composeExistingSurfaceSection(cards, options?)`

Pure renderer. Returns the `## Existing surface` markdown section, or `''` for an empty
card list.

- `cards: ExistingSurfaceCard[]` — already ranked (highest first).
- `options.tokenBudget?: number` — hard budget; defaults to
  `DEFAULT_EXISTING_SURFACE_TOKENS` (1000). Cards past the budget are dropped by rank and
  summarised by the honest truncation line.

### `gatherExistingSurface(projectRoot, options?)`

Best-effort IO composer. Returns the composed section, or `''` when nothing is
implicated or on any failure (never throws).

- `options.changedPaths?: readonly string[]` — the working set (files being changed).
- `options.query?: string` — the prompt text, to pull in named files/symbols.
- `options.tokenBudget?: number` — budget override.

### `selectCandidateFiles(allFiles, workingSet, query, index)`

Returns the scoped candidate file list: working-set-module files plus files the prompt
names by basename (or, with the index, by defined symbol name).

## Types

```ts
interface ExistingSurfaceCard {
  name: string;
  signature?: string;
  file: string;
  line?: number;
  callerCount?: number;
  module?: string;
}
```

## Configuration

| Key | Env | Default | Meaning |
| --- | --- | --- | --- |
| `existing_surface_tokens` | `PAQAD_EXISTING_SURFACE_TOKENS` | `1000` | Token budget for the section; cards drop by rank past this budget. |

## Output shape

```
## Existing surface — <N> existing symbols for the files in play
> Before writing new helpers, check this surface — these already exist in this project.

- `buildProjectRepoMap(projectRoot, options): Promise<RepoMapResult>` — src/rag/repo-map.ts:230 · called from 1 place · hybrid-rag
- …
…and <K> more exported symbols — run `paqad-ai index query <name>` to look one up.
```
