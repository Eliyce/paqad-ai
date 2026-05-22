# Module Registry

Authoritative source: [docs/instructions/rules/module-map.yml](../rules/module-map.yml).
This page is a human-readable mirror — regenerate after every map change.

paqad-ai's modules live in three layers:

- **cli-commands** — what a human runs in the terminal; no LLM in the loop.
- **agent-workflows** — what an LLM does after loading the adapter entry file (CLAUDE.md / AGENTS.md / …) and following the runtime rules and skills shipped here.
- **framework-internals** — engines and runtime assets that power both surfaces; docs are for paqad-ai contributors.

## Layer 1 — CLI Commands (non-AI surface)

| Slug                | Name                                         | Features |
| ------------------- | -------------------------------------------- | -------- |
| cli-lifecycle       | Project Lifecycle Commands                   | install, onboard, refresh, update |
| cli-health          | Health & Diagnostics Commands                | doctor, module-health |
| cli-rag             | RAG Index Commands                           | init, rebuild, status, clear, eval |
| cli-graph           | Project Graph Command                        | graph server, graph-ui SPA, similarity overlay |
| cli-packs           | Pack Management Commands                     | list, install, remove, validate, create |
| cli-capabilities    | Capability Toggle Commands                   | list, add, remove |
| cli-patterns        | Pattern Library Commands                     | list, prune, export |
| cli-compliance      | Spec Compliance Commands                     | extract, check, review, skeleton, doctor, boundary, patterns |
| cli-plan            | Resumable Plan Command                       | plan resume |
| adapter-onboarding  | Adapter Onboarding (LLM platform entry files)| claude-code, codex-cli, antigravity, gemini-cli, junie, cursor, github-copilot, windsurf, continue, aider |

## Layer 2 — Agent Workflows (LLM-facing surface)

| Slug                            | Name                                  | Trigger phrase / source |
| ------------------------------- | ------------------------------------- | ------------------------ |
| documentation-workflow          | Documentation Workflow                | "create documentation" / "create module documentation" |
| pentest-workflow                | Security Pentest Workflow             | "run pentest" / "retest pentest" |
| feature-development-workflow    | Feature Development Workflow          | `docs/instructions/workflows/feature-development.yaml` |
| root-cause-analysis-workflow    | Root Cause Analysis Workflow          | RCA-triggered |
| agent-routing                   | Agent Routing & Capability Lanes      | router agent + capabilities |

## Layer 3 — Framework Internals (contributor-facing)

| Slug                       | Name                                   |
| -------------------------- | -------------------------------------- |
| stack-detection-engine     | Stack Detection Engine                 |
| pack-system                | Pack System (22 built-in packs)        |
| capability-model           | Capability Model (content / coding / security) |
| workflow-engine            | Workflow Engine                        |
| skill-runtime              | Skill Runtime                          |
| agent-runtime              | Built-in Agent Roles (20)              |
| rules-runtime              | Rules Bundle                           |
| template-engine            | Template Engine                        |
| context-intelligence       | Context Intelligence                   |
| hybrid-rag                 | Hybrid RAG Runtime                     |
| mcp-config                 | MCP Configuration                      |
| module-map-engine          | Module Map Engine                      |
| module-health-ledger       | Module Health Ledger                   |
| session-handoff            | Session Handoff & Predictive Cache     |
| decision-pause-contract    | Decision Pause Contract                |
| pattern-library            | Cross-Project Pattern Library          |
| compliance-engine          | Spec Compliance Engine                 |
| pentest-engine             | Pentest Engine (12 Skills)             |
| project-profile-schema     | Project Profile & Onboarding Manifest  |
| repository-resolver        | Repository Resolver                    |

## Confidence

Map confidence overall: **high**. Low-confidence modules flagged for review before Stage 2:
`root-cause-analysis-workflow`, `agent-routing`, `feature-development-workflow`, `pattern-library`, `repository-resolver`.
