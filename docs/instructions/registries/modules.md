# Module Registry

Authoritative source: [docs/instructions/rules/module-map.yml](../rules/module-map.yml).
This page is a human-readable mirror — regenerate after every map change.

paqad-ai's modules live in three layers:

- **cli-commands** — what a human runs in the terminal; no LLM in the loop.
- **agent-workflows** — what an LLM does after loading the adapter entry file (CLAUDE.md / AGENTS.md / …) and following the runtime rules and skills shipped here.
- **framework-internals** — engines and runtime assets that power both surfaces; docs are for paqad-ai contributors.

## Layer 1 — CLI Commands (non-AI surface)

| Slug                | Name                                         | Docs | Features |
| ------------------- | -------------------------------------------- | ---- | -------- |
| cli-lifecycle       | Project Lifecycle Commands                   | [↗](../../modules/cli-lifecycle/index/summary.md) | install, onboard, refresh, update |
| cli-health          | Health & Diagnostics Commands                | [↗](../../modules/cli-health/index/summary.md) | doctor, module-health |
| cli-rag             | RAG Index Commands                           | [↗](../../modules/cli-rag/index/summary.md) | init, rebuild, status, clear, eval |
| cli-graph           | Project Graph Command                        | [↗](../../modules/cli-graph/index/summary.md) | graph server, graph-ui SPA, similarity overlay |
| cli-dashboard       | Project Dashboard & Status Commands          | [↗](../../modules/cli-dashboard/index/summary.md) | dashboard, status, approvals, trust, seven-area IA, write pipeline |
| cli-packs           | Pack Management Commands                     | [↗](../../modules/cli-packs/index/summary.md) | list, install, remove, validate, create |
| cli-capabilities    | Capability Toggle Commands                   | [↗](../../modules/cli-capabilities/index/summary.md) | list, add, remove |
| cli-patterns        | Pattern Library Commands                     | [↗](../../modules/cli-patterns/index/summary.md) | list, prune, export |
| cli-compliance      | Spec Compliance Commands                     | [↗](../../modules/cli-compliance/index/summary.md) | extract, check, review, skeleton, doctor, boundary, patterns |
| cli-audit           | Trust Export Commands (audit + evidence)     | [↗](../../modules/cli-audit/index/summary.md) | audit export (OCSF/ECS/CEF/JSONL), evidence PR comment |
| cli-module-map      | Module Map Inspection Commands               | [↗](../../modules/cli-module-map/index/summary.md) | module-map reconcile, module-decisions, module-events |
| cli-plan            | Resumable Plan Command                       | [↗](../../modules/cli-plan/index/summary.md) | plan resume |
| adapter-onboarding  | Adapter Onboarding (LLM platform entry files)| [↗](../../modules/adapter-onboarding/index/summary.md) | claude-code, codex-cli, antigravity, gemini-cli, junie, cursor, github-copilot, windsurf, continue, aider |

## Layer 2 — Agent Workflows (LLM-facing surface)

| Slug                            | Name                                  | Docs | Trigger phrase / source |
| ------------------------------- | ------------------------------------- | ---- | ------------------------ |
| documentation-workflow          | Documentation Workflow                | [↗](../../modules/documentation-workflow/index/summary.md) | "create documentation" / "create module documentation" |
| pentest-workflow                | Security Pentest Workflow             | [↗](../../modules/pentest-workflow/index/summary.md) | "run pentest" / "retest pentest" |
| feature-development-workflow    | Feature Development Workflow          | [↗](../../modules/feature-development-workflow/index/summary.md) | `docs/instructions/workflows/feature-development.yaml` |
| root-cause-analysis-workflow    | Root Cause Analysis Workflow          | [↗](../../modules/root-cause-analysis-workflow/index/summary.md) | RCA-triggered |
| agent-routing                   | Agent Routing & Capability Lanes      | [↗](../../modules/agent-routing/index/summary.md) | router agent + capabilities |

## Layer 3 — Framework Internals (contributor-facing)

| Slug                       | Name                                   | Docs |
| -------------------------- | -------------------------------------- | ---- |
| stack-detection-engine     | Stack Detection Engine                 | [↗](../../modules/stack-detection-engine/index/summary.md) |
| pack-system                | Pack System (22 built-in packs)        | [↗](../../modules/pack-system/index/summary.md) |
| capability-model           | Capability Model (content / coding / security) | [↗](../../modules/capability-model/index/summary.md) |
| workflow-engine            | Workflow Engine                        | [↗](../../modules/workflow-engine/index/summary.md) |
| skill-runtime              | Skill Runtime                          | [↗](../../modules/skill-runtime/index/summary.md) |
| agent-runtime              | Built-in Agent Roles (20)              | [↗](../../modules/agent-runtime/index/summary.md) |
| rules-runtime              | Rules Bundle                           | [↗](../../modules/rules-runtime/index/summary.md) |
| template-engine            | Template Engine                        | [↗](../../modules/template-engine/index/summary.md) |
| context-intelligence       | Context Intelligence                   | [↗](../../modules/context-intelligence/index/summary.md) |
| hybrid-rag                 | Hybrid RAG Runtime                     | [↗](../../modules/hybrid-rag/index/summary.md) |
| background-harness         | Background-Worker Harness              | [↗](../../modules/background-harness/index/summary.md) |
| mcp-config                 | MCP Configuration                      | [↗](../../modules/mcp-config/index/summary.md) |
| module-map-engine          | Module Map Engine                      | [↗](../../modules/module-map-engine/index/summary.md) |
| module-health-ledger       | Module Health Ledger                   | [↗](../../modules/module-health-ledger/index/summary.md) |
| session-handoff            | Session Handoff & Predictive Cache     | [↗](../../modules/session-handoff/index/summary.md) |
| decision-pause-contract    | Decision Pause Contract                | [↗](../../modules/decision-pause-contract/index/summary.md) |
| pattern-library            | Cross-Project Pattern Library          | [↗](../../modules/pattern-library/index/summary.md) |
| compliance-engine          | Spec Compliance Engine                 | [↗](../../modules/compliance-engine/index/summary.md) |
| traceability-engine        | Bidirectional Traceability Engine      | [↗](../../modules/traceability-engine/index/summary.md) |
| quality-ratchet            | Quality Ratchet                        | [↗](../../modules/quality-ratchet/index/summary.md) |
| verification               | Verification Gates                     | [↗](../../modules/verification/index/summary.md) |
| evidence-ledger            | Evidence Ledger & Provenance Receipt   | [↗](../../modules/evidence-ledger/index/summary.md) |
| delivery-workflow          | Provider-Agnostic Delivery Workflow    | [↗](../../modules/delivery-workflow/index/summary.md) |
| pentest-engine             | Pentest Engine (12 Skills)             | [↗](../../modules/pentest-engine/index/summary.md) |
| project-profile-schema     | Project Profile & Onboarding Manifest  | [↗](../../modules/project-profile-schema/index/summary.md) |
| repository-resolver        | Repository Resolver                    | [↗](../../modules/repository-resolver/index/summary.md) |

## Confidence

Map confidence overall: **high**. Low-confidence modules flagged for review before Stage 2:
`root-cause-analysis-workflow`, `agent-routing`, `feature-development-workflow`, `pattern-library`, `repository-resolver`.
