# Stack Overview

## Project

- **Name:** paqad-ai
- **Version:** see `package.json` (root), graph-ui sub-app independent
- **Description:** Spec-driven development framework — AI agents that think before they type
- **License:** MIT
- **Entry archetype:** Node library + CLI (`paqad-ai` bin), with an embedded React SPA (`graph-ui`)

## Top-Level Toolchain

| Concern         | Choice                                                         |
|-----------------|----------------------------------------------------------------|
| Language        | TypeScript (ES modules, `"type": "module"`)                    |
| Node engine     | `>=22.0.0` to install; building needs 22.18+ (24.11+ on 24)    |
| Package manager | pnpm (root + `graph-ui`)                                       |
| Bundler         | tsup 9 (library/CLI, shared chunks, no source maps), Vite (graph-ui SPA) |
| Test runner     | Vitest 5 (root and graph-ui)                                   |
| Lint            | ESLint (flat config: `eslint.config.js`)                       |
| Format          | Prettier                                                       |
| Typecheck       | `tsc --noEmit`                                                 |

Building from source needs Node 22.18 or later (24.11 or later on Node 24) because tsup 9
needs it. The published `engines` field stays `>=22.0.0`. Exact ranges are in
[versions.md](versions.md).

## Frameworks & Major Libraries

### CLI / Framework Runtime (root)

- `commander` — CLI argument parsing
- `@inquirer/prompts` — interactive prompts
- `chalk`, `ora` — terminal UX
- `execa` — subprocess execution
- `fast-glob`, `pathe` — filesystem scanning
- `handlebars` — template rendering (workflow & doc templates)
- `yaml` — config / profile parsing
- `ajv` — JSON Schema validation
- `openai` — model API client (default routing target) and the optional cloud embeddings
- `@huggingface/transformers` v4 — local embeddings and reranking, pinned to `dtype: 'q8'`
- `gifenc` — GIF encoding for visual evidence

### Embedded UI (`graph-ui/`)

- React 19
- Tailwind CSS 4
- Vite SPA toolchain
- Vitest 5 (the same major as the root package)

## Capabilities (active)

`content`, `coding`, `security`

## Detected Traits

`eslint`, `tailwind`, `typescript`, `vite-spa`, `vitest`

## Repository Layout (top-level)

```
src/                # framework source (CLI, runtime, intelligence, workflows)
runtime/            # shipped runtime assets (rules, skills, templates) — packaged in dist
graph-ui/           # standalone React + Vite SPA for graph visualization
scripts/            # build & test helper scripts
tests/              # vitest test suites
docs/instructions/  # canonical project docs (this directory)
.paqad/             # framework metadata: profile, detection, decisions, vectors
website/            # docs/marketing site assets
```

## Commands

| Action    | Command          |
|-----------|------------------|
| Install   | `pnpm install`   |
| Dev       | `pnpm dev`       |
| Test      | `pnpm test`      |
| Lint      | `pnpm lint`      |
| Format    | `pnpm format`    |
| Build     | `pnpm build`     |
| Typecheck | `pnpm typecheck` |
| Full CI   | `pnpm ci`        |
