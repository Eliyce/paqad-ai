# Architecture Overview

paqad-ai is a spec-driven development framework distributed as an npm package. It ships a CLI, a TypeScript library, a
runtime asset bundle (rules, skills, templates), and a standalone React SPA (`graph-ui`) for visualization.

## High-Level Components

```
┌──────────────────────────────────────────────────────────────┐
│                          paqad-ai CLI                         │
│  (commander program → src/cli/commands/*)                    │
└──────────────────────────────────────────────────────────────┘
        │                │                  │             │
        ▼                ▼                  ▼             ▼
   Onboarding       Workflows           Intelligence    Module Health
   (detect →        (engine, steps,     (RAG, context,  (introspection,
    profile →       parallel exec,      embeddings,     map, registries)
    scaffold)       templates)          token budgets)
        │                │                  │             │
        └────────────────┴──────────────────┴─────────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │   Runtime Assets      │
                  │ runtime/base/{rules,  │
                  │  skills, agents}      │
                  │ runtime/templates/**  │
                  └───────────────────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │  .paqad/ (project)    │
                  │  profile, detection,  │
                  │  decisions, vectors   │
                  └───────────────────────┘

graph-ui/  →  separate Vite + React 19 SPA, consumes graph data exported by the CLI.
```

## Layers

1. **CLI layer** (`src/cli/`) — Commander program, command modules (`onboard`, `plan`, `refresh`, `update`, `rag`,
   `graph`, `module-health`, etc.), terminal UI helpers.
2. **Core layer** (`src/core/`) — Project profile, stack profile, capability model, runtime paths.
3. **Onboarding** (`src/onboarding/`) — Detection → profile generation → scaffolding of `.paqad/` and
   `docs/instructions/`.
4. **Workflows engine** (`src/workflows/`) — Loads YAML workflow definitions, plans steps, runs sequential/parallel
   executors with handlebars templating.
5. **Intelligence layer** — RAG indexing (`src/rag`), embeddings (cloud via VoyageAI, local via transformers), context
   budget planning (`src/context`, `src/token-efficiency`), caching (`src/cache`).
6. **Skills system** (`src/skills/`) — Discovers and loads skills from `runtime/base/skills/**`.
7. **Module map / health** (`src/module-map`, `src/module-health`, `src/introspection`) — Static analysis of repo
   structure into business modules and feature slugs.
8. **Compliance, pentest, validators** (`src/compliance`, `src/pentest`, `src/validators`, `src/verification`) —
   Security/quality gates.
9. **MCP** (`src/mcp/`) — Optional integration with Model Context Protocol servers.
10. **Graph rendering** (`src/graph/`) — Builds graph data consumed by `graph-ui/`.
11. **Templates** (`src/templates`, `runtime/templates/**`) — Handlebars templates for docs and module scaffolds.

## Build & Distribution

- `tsup` builds the library + CLI into `dist/`.
- `graph-ui/` is built via Vite and bundled alongside (`pnpm run graph-ui:build`).
- Published `files`: `dist`, `runtime`, `scripts`.
- Binary: `paqad-ai` → `dist/cli/index.js`.

## Data Flow — `paqad-ai onboard`

```
detect stack ──▶ project-profile.yaml ──▶ scaffold .paqad/ + docs/instructions/rules
       │                  │
       ▼                  ▼
detection-report.json   onboarding-manifest.json
```

## Data Flow — `create documentation` (this workflow)

```
.paqad/project-profile.yaml + detection-report.json
            │
            ▼
   foundation generator (Stage 1) ──▶ docs/instructions/**
            │                          docs/instructions/rules/module-map.yml
            ▼
   .paqad/doc-progress.json (moduleDocStage: pending_map_review)
            │
            ▼  (after user reviews map)
   module-doc generator (Stage 2)  ──▶ docs/modules/**
```

## External Dependencies

- **OpenAI API** — default reasoning model (`gpt-5`), fast model (`gpt-5-mini`).
- **VoyageAI** — cloud embedding provider (optional).
- **Local embeddings** — `Xenova/all-MiniLM-L6-v2` via `@xenova/transformers` (default when
  `intelligence.embedding_provider: local`).
- **MCP servers** — none configured (`mcp.servers: []`).
