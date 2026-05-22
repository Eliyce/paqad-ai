# CLI Command Registry

Source: `src/cli/commands/*.ts`. Regenerate when adding/removing commands.

| Command         | File                              | Purpose                                        |
| --------------- | --------------------------------- | ---------------------------------------------- |
| `onboard`       | `src/cli/commands/onboard.ts`     | Detect stack, write `.paqad/` and rules        |
| `plan`          | `src/cli/commands/plan.ts`        | Build / resume an execution plan               |
| `refresh`       | `src/cli/commands/refresh.ts`     | Refresh detection + profile                    |
| `update`        | `src/cli/commands/update.ts`      | Update framework assets                        |
| `install`       | `src/cli/commands/install.ts`     | Install/relink runtime                         |
| `doctor`        | `src/cli/commands/doctor.ts`      | Diagnostics                                    |
| `rag`           | `src/cli/commands/rag.ts`         | RAG index/query                                |
| `graph`         | `src/cli/commands/graph.ts`       | Export graph data for `graph-ui`               |
| `module-health` | `src/cli/commands/module-health.ts` | Module-level health scan                     |
| `capabilities`  | `src/cli/commands/capabilities.ts`| Inspect / toggle capabilities                  |
| `compliance`    | `src/cli/commands/compliance.ts`  | Run compliance checks                          |
| `packs`         | `src/cli/commands/packs.ts`       | List / install compliance packs                |
| `patterns`      | `src/cli/commands/patterns.ts`    | Inspect detection patterns                     |
