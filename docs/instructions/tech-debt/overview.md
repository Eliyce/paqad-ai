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

## Tracked items

Each open `TD-<ULID>` item recorded with `paqad-ai debt add` is listed here, newest first. paqad rewrites the lines between the markers; edit the item files, not this list.

<!-- paqad:tech-debt:start -->
- [TD-01M5F8RJE9HCHZ4Y0DB8ABT89F](TD-01M5F8RJE9HCHZ4Y0DB8ABT89F.md) (debt, medium): HUD snapshot write takes ~150 ms after the Desktop HUD git reads
- [TD-01M5ERXBAP7SWTDGBS07M59BHE](TD-01M5ERXBAP7SWTDGBS07M59BHE.md) (bug, medium): CLI-resolved contract decisions never reach the decision index, so answered forks can be re-asked
- [TD-01M5ERXAVWBZ4D9RK3DMP4HY6X](TD-01M5ERXAVWBZ4D9RK3DMP4HY6X.md) (bug, medium): Decision self-arm mints create-vs-reuse from injected CLAUDE.md/memory text and for files outside the repo
- [TD-01M5DSTMPPCAXKJ25R9162YBCR](TD-01M5DSTMPPCAXKJ25R9162YBCR.md) (gap, low): HUD band, close and Ledger flows have no site-map journey
- [TD-01M5DFWBB40C2D5J1EBEFQ3TEC](TD-01M5DFWBB40C2D5J1EBEFQ3TEC.md) (bug, medium): Capability-gate pre-mutation hook times out on a cold run (about 10.4s vs its 10s timeout), blocking the first edit after a tree change
- [TD-01M5D6STQ75DHDQ4Y05KCWB4TT](TD-01M5D6STQ75DHDQ4Y05KCWB4TT.md) (debt, medium): The build rewrites the tracked plugin.json version and flips two hook file modes
- [TD-01M5D0M3XDBWAMK4H8DV6AJ543](TD-01M5D0M3XDBWAMK4H8DV6AJ543.md) (bug, medium): Commits after a bundle closes open a stray fast-lane bundle
- [TD-01M5CY6GZB3NG4PMAG57YYMV9Z](TD-01M5CY6GZB3NG4PMAG57YYMV9Z.md) (gap, medium): Allow once also replaces a deny from another tool's PreToolUse hook on the same edit
- [TD-01M5CW8WGAFVSRZ3AHEKD9VMS8](TD-01M5CW8WGAFVSRZ3AHEKD9VMS8.md) (gap, medium): Rule override rows claim by human but the agent can read the stop token and call the verb
- [TD-01M5CW8DEWNY2P12TPR53RH4ZQ](TD-01M5CW8DEWNY2P12TPR53RH4ZQ.md) (bug, medium): Implementation-review gate demands citations for duplication rows outside the change diff
- [TD-01M5CW8D61K3PJVG7NW6Y2YQ52](TD-01M5CW8D61K3PJVG7NW6Y2YQ52.md) (bug, medium): Stop gate judges a change while High Table expert subagents still run in the background
<!-- paqad:tech-debt:end -->
