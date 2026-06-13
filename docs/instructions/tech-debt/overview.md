# Tech Debt Register

Open items captured during the foundation documentation pass. Promote to issues as they are scheduled.

## Detected Inconsistencies

- **Mixed lockfiles.** Both `pnpm-lock.yaml` and `package-lock.json` exist at root and in `graph-ui/`. pnpm is canonical (per `project-profile.yaml`); the npm lockfiles should be removed once verified unused.
- **Archetype ambiguity.** Detection report classified the repo as `node-cli` with `medium` confidence but the project is also a published library (`main`, `exports`). Treat it as **library + CLI hybrid** until detection is refined.
- **Migrate command unset.** `commands.migrate` in the profile is the placeholder `echo "configure migrate command"`. Set or remove before Stage 2.
- **MCP servers empty.** `mcp.servers: []` — wire actual servers if MCP features (`mcp_first: true`) are intended to function.

## Known Gaps

- Module map v2 confidence is **high** overall, with five low-confidence modules still flagged: `root-cause-analysis-workflow`, `agent-routing`, `feature-development-workflow`, `pattern-library`, `repository-resolver`. Each needs a contributor pass.
- **Module docs lag the refreshed map.** The 2026-06-13 foundation refresh added `cli-dashboard`, `cli-module-map`, `verification`, `evidence-ledger`, and `delivery-workflow` to the map. `docs/modules/cli-dashboard` and `docs/modules/cli-module-map` do not exist yet, and `docs/modules/verification` has feature pages (mutation-testing, flaky-handling) but no `index/summary.md`. Re-run **`create module documentation`** (Stage 2) to close the gap.
- No error-catalog has been produced; module docs (Stage 2) should populate `docs/modules/{slug}/error-catalog.md` where errors exist.
- Benchmark eval (model-graded) is disabled — enable when measuring RAG changes.

## Follow-ups

- Decide whether `website/` participates in the canonical docs flow (currently outside `docs/instructions`).
- Consolidate detection signals: `detected_stack` says `node-cli`, but `matched_packs` includes `node-library` and `react`.
