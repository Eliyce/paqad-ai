# Stack Overview

## Project

- **Name:** paqad-ai
- **Version:** 1.0.2 (root), graph-ui sub-app independent
- **Description:** Spec-driven development framework — AI agents that think before they type
- **License:** MIT
- **Entry archetype:** Node library + CLI (`paqad-ai` bin), with an embedded React SPA (`graph-ui`)

## Top-Level Toolchain

| Concern         | Choice                                               |
|-----------------|------------------------------------------------------|
| Language        | TypeScript (ES modules, `"type": "module"`)          |
| Node engine     | `>=22.0.0`                                           |
| Package manager | pnpm (root + `graph-ui`), npm lockfiles also present |
| Bundler         | tsup (library/CLI), Vite (graph-ui SPA)              |
| Test runner     | Vitest                                               |
| Lint            | ESLint (flat config: `eslint.config.js`)             |
| Format          | Prettier                                             |
| Typecheck       | `tsc --noEmit`                                       |

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
- `openai` — model API client (default routing target)
- `voyageai`, `@xenova/transformers` — embeddings (cloud + local)

### Embedded UI (`graph-ui/`)

- React 19
- Tailwind CSS 4
- Vite SPA toolchain
- Vitest

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
