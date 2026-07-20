# CLI Command Registry

Source: `src/cli/commands/*.ts`. Regenerate when adding/removing commands.

## Lifecycle & diagnostics

| Command         | File                              | Purpose                                        |
| --------------- | --------------------------------- | ---------------------------------------------- |
| `onboard`       | `src/cli/commands/onboard.ts`     | Detect stack, write `.paqad/` and rules        |
| `refresh`       | `src/cli/commands/refresh.ts`     | Refresh detection + profile                    |
| `update`        | `src/cli/commands/update.ts`      | Update framework assets                        |
| `install`       | `src/cli/commands/install.ts`     | Install/relink runtime                         |
| `doctor`        | `src/cli/commands/doctor.ts`      | Diagnostics                                    |
| `status`        | `src/cli/commands/status.ts`      | Print a one-shot dashboard report (Markdown or JSON) |
| `dashboard`     | `src/cli/commands/dashboard.ts`   | Open the project dashboard in a local web view |

## Intelligence & graph

| Command         | File                              | Purpose                                        |
| --------------- | --------------------------------- | ---------------------------------------------- |
| `rag`           | `src/cli/commands/rag.ts`         | Manage optional hybrid RAG context retrieval (`init`/`rebuild`/`status`/`clear`) |
| `graph`         | `src/cli/commands/graph.ts`       | Open a local web view of the project graph     |

## Module map & health

| Command            | File                                | Purpose                                        |
| ------------------ | ----------------------------------- | ---------------------------------------------- |
| `module-health`    | `src/cli/commands/module-health.ts` | Module-level health scan                       |
| `module-map`       | `src/cli/commands/module-map.ts`    | Reconcile `module-map.yml` against the source tree (`reconcile`) |
| `module-decisions` | `src/cli/commands/module-decisions.ts` | Inspect MD-XXXX prospective module decisions (`list`/`show`/`expire-stale`/`extract`) |
| `module-events`    | `src/cli/commands/module-events.ts` | Inspect the module-map `events.jsonl` audit trail (`list`/`since`/`for-module`) |

## Governance, compliance & trust

| Command         | File                              | Purpose                                        |
| --------------- | --------------------------------- | ---------------------------------------------- |
| `capabilities`  | `src/cli/commands/capabilities.ts`| Inspect / toggle capabilities                  |
| `compliance`    | `src/cli/commands/compliance.ts`  | Spec compliance verification tools (`extract`/`review`/`check`/`skeleton`/`doctor`/`boundary`/`patterns`) |
| `packs`         | `src/cli/commands/packs.ts`       | List / install compliance packs                |
| `patterns`      | `src/cli/commands/patterns.ts`    | Inspect detection patterns                     |
| `evidence`      | `src/cli/commands/evidence.ts`    | Render verification evidence as a scannable PR comment (Markdown or JSON) |
| `audit`         | `src/cli/commands/audit.ts`       | Export the evidence ledger to your own SIEM — OCSF/ECS/CEF/JSONL, read-only, local-first (`export`) |
| `duplication`   | `src/cli/commands/duplication.ts` | Flag new code that near-copies existing helpers, new-code-only and deterministic (`scan`) |
