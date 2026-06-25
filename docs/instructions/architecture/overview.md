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
8. **Compliance, pentest, validators** (`src/compliance`, `src/pentest`, `src/validators`) —
   Security/quality gates.
9. **Verification & trust** (`src/verification`, `src/evidence`, `src/traceability`, `src/quality-ratchet`,
   `src/audit`) — The gate bank (#117) that decides whether a change lands, the unified evidence ledger +
   per-change provenance receipt (#118/#120), bidirectional promise↔code↔test traceability, the quality
   ratchet, and the read-only SIEM exporter (#121). The evidence ledger is an **opt-in enterprise
   capability, off by default** (#187): with the `enterprise` knobs unset (their default is off in
   `src/core/framework-config.ts`, overridable via `.paqad/.config`), a verification run writes no
   `.paqad/ledger/` files and resolves no compliance citations (the token-spending path).
   `src/core/enterprise-policy.ts` is the single resolver — and the seam a future license/token check
   slots behind.
10. **Delivery** (`src/delivery`, `src/providers`) — Provider-agnostic delivery automation (#42) behind the
    `TicketProvider` (Jira) and `HostProvider` (GitHub) contracts, conventions detected from git history.
11. **Dashboard** (`src/dashboard`) — Local web view + one-shot `status` report; shares the `graph-ui` bundle
    via a hash router and serves the approvals inbox, trust area, and audited write pipeline (#146).
12. **MCP** (`src/mcp/`) — Optional integration with Model Context Protocol servers.
13. **Graph rendering** (`src/graph/`) — Builds graph data consumed by `graph-ui/`.
14. **Templates** (`src/templates`, `runtime/templates/**`) — Handlebars templates for docs and module scaffolds.

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
  `rag_embedding_provider=local`, a framework knob in the config layer).
- **MCP servers** — none configured (`mcp.servers: []` in `project-profile.yaml`).

> Framework knobs (RAG, model routing, strictness, enterprise, escalation,
> features) are **not** in `project-profile.yaml`. They come from code defaults in
> `src/core/framework-config.ts`, overridable through the config layer — tracked
> team `.paqad/configs/.config.*`, git-ignored local `.paqad/.config` (local wins),
> and `PAQAD_*` env — with every knob documented (commented out at its default) in
> the tracked `.paqad/configs/.config.*` files. The profile holds only
> project facts (name, commands, `mcp.servers`, detected `stack_profile` /
> `active_capabilities`, and the project-owned `custom` arrays).
