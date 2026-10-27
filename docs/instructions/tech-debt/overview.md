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
- [TD-01M5YAWM5ZRVGHFP34DKA0W3JB](TD-01M5YAWM5ZRVGHFP34DKA0W3JB.md) (gap, medium): Skill Authoring rule RL-70a6 flags the claude.ai compatibility key on every Claude plugin skill
- [TD-01M5YAWJ4XG3MM5K4S3HWR1X9D](TD-01M5YAWJ4XG3MM5K4S3HWR1X9D.md) (debt, low): Generated module summary footer is duplicated across 37 docs/modules pages and trips the duplication detector
- [TD-01M5YA4ANCER1JN9YTS2JCDE0S](TD-01M5YA4ANCER1JN9YTS2JCDE0S.md) (follow-up, low): The ChatGPT directory zip is not attached to the GitHub Release
- [TD-01M5YA48T7EM2P3KHFM12T8XFD](TD-01M5YA48T7EM2P3KHFM12T8XFD.md) (debt, low): Python 3.9 is past end of life but still pinned in the discovery-plugin CI job
- [TD-01M5VRJ2E7XV7F5VZKB3FXKQRK](TD-01M5VRJ2E7XV7F5VZKB3FXKQRK.md) (gap, low): HUD binds a foreground Agent call to the first new agent id; parallel or same-message dispatches are not told apart
- [TD-01M5VRHVTQ24C395EA30WZ41TD](TD-01M5VRHVTQ24C395EA30WZ41TD.md) (gap, low): SessionStart release trusts the hook's parent pid, which can be a short-lived shell or a reused pid
- [TD-01M5VRH711MWY0XT02FZSQ3KQS](TD-01M5VRH711MWY0XT02FZSQ3KQS.md) (gap, low): Codex writes no started stage-agent row, so the ledger cannot defer there
- [TD-01M5VQ75JG902H89W2FCE5P6QG](TD-01M5VQ75JG902H89W2FCE5P6QG.md) (gap, low): The cost total leaves out High Table seat tokens that only the host reported
- [TD-01M5VMXRMKTVPN1735B09YYQPZ](TD-01M5VMXRMKTVPN1735B09YYQPZ.md) (gap, medium): A stage agent killed mid-session without SubagentStop holds the turn-end judgement until the next stage row or session
- [TD-01M5SHTYS3TRMRNHHJT3YKVDJY](TD-01M5SHTYS3TRMRNHHJT3YKVDJY.md) (bug, low): Concurrent background-agent permission asks: settling the later one clears the band while the earlier one still waits
- [TD-01M5SHTX96QGWZECDMF2926BA4](TD-01M5SHTX96QGWZECDMF2926BA4.md) (gap, low): Stop hooks skip the deferral check when background_tasks is empty, so a checks-run marker alone never defers
- [TD-01M5KR7VM51BM5SPDQ4JC3JDAK](TD-01M5KR7VM51BM5SPDQ4JC3JDAK.md) (gap, low): Firewall eval rule cases grade only src/api/users.ts, so a db import in a new src/api file scores as a pass
- [TD-01M5KR7T2DSW4BZHHEGBD2D0NV](TD-01M5KR7T2DSW4BZHHEGBD2D0NV.md) (bug, medium): Turn-end completion gate grades a change while a plugin-namespaced paqad stage agent still runs in the background
- [TD-01M5JNJHZWFAWGY74TA5JGV1C7](TD-01M5JNJHZWFAWGY74TA5JGV1C7.md) (bug, medium): Plugin session start writes an unquoted PATH into CLAUDE_ENV_FILE, breaking Bash when the plugin root has a space
- [TD-01M5JNJGFMSQP1XH0N3D5X9TJ3](TD-01M5JNJGFMSQP1XH0N3D5X9TJ3.md) (bug, medium): Pre-mutation rule gate crashes with EISDIR when git status lists paths outside the project root
- [TD-01M5JE09CZQAYQZ9ZMFVAG046T](TD-01M5JE09CZQAYQZ9ZMFVAG046T.md) (bug, high): Every coding prompt is guessed onto the fast lane because the prompt seam classifies without the project profile
- [TD-01M5H0JNXKCZP80ST1AW0AWTN8](TD-01M5H0JNXKCZP80ST1AW0AWTN8.md) (debt, low): Plugin engine loads now spawn an extra npm root -g per optional-package load
- [TD-01M5H0JMNJGP9Q62GATTFZYHW1](TD-01M5H0JMNJGP9Q62GATTFZYHW1.md) (debt, medium): stage-guardrail AC-69 test is flaky under full-suite load
- [TD-01M5H0JKDRHQE25RE3K96DXHW3](TD-01M5H0JKDRHQE25RE3K96DXHW3.md) (bug, low): Dashboard serveStatic sends the directory's size as content-length when it serves a directory index.html without gzip
- [TD-01M5FD66BBD0HBQSYJDC9Z1Z6Z](TD-01M5FD66BBD0HBQSYJDC9Z1Z6Z.md) (gap, low): Terminal HUD still reads Getting ready when it cannot read the session's record
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
