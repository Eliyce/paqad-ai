---
name: documentation-sync-engine
description: Canonical orchestrator that runs the fast stale-doc detector and dispatches to per-domain doc-sync skills for the affected canonical paths.
model_tier: medium
triggers:
  - workflow:
      - feature-development
      - bug-fix
      - refactor
      - migration
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  changed_files:
    type: path[]
    required: true
    description: Changed source or doc files from the current diff.
  detector_script_path:
    type: path
    required: true
    description: Path to the canonical stale doc detector used by diff-doc-sync.
  target_domains:
    type: string[]
    required: false
    description: Optional restriction to specific domains (api, integration, module, error, glossary). Empty means all.
---

## What It Does

Acts as the canonical entry point for post-implementation documentation sync. Runs `diff-doc-sync` first to narrow to actually-stale canonical doc paths, then dispatches each path to the domain-specific maintainer (api, integration, error catalog, canonical, or glossary). Aggregates the results into a single report so the caller does not have to invoke five skills sequentially.

The point is to give callers one place to ask "sync the docs after this change" and get consistent, deduplicated output every time.

## Use This When

Use this after implementation lands (or just before handoff) on `feature-development`, `bug-fix`, `refactor`, or `migration` workflows. Skip when `differential_refresh` is disabled in the project profile and the team prefers running the per-domain skills directly.

## Inputs

- Read the changed file list at `changed_files`.
- Use the detector at `detector_script_path` (via `diff-doc-sync`) to produce the stale canonical doc set.
- Read `references/orchestration-rules.md` before dispatching so the routing rules and execution order stay consistent across runs.
- When `target_domains` is non-empty, intersect the dispatched set with the requested domains.

## Procedure

1. Invoke `diff-doc-sync` with the changed file list to produce the candidate stale doc set (JSON array).
2. Pipe that array's paths into `scripts/route-paths.sh` to assign each path a delegate domain (`api | integration | error | glossary | canonical`); see `assets/routing-table.txt` for the mapping.
3. Apply `target_domains` filtering if provided.
4. Invoke each delegate skill once with only its domain's paths.
5. Aggregate delegate outputs and format per `assets/output.template.md`.
6. Validate with `scripts/lint-output.sh`.

## Output Contract

- Return a heading named `Documentation Sync`.
- Provide a `Stale Doc Set` line: `Detected: {N} | Routed: {M} | Skipped (target_domains filter): {K}`.
- For each domain that ran, emit a third-level heading `### {domain}` and list the paths the delegate updated, plus any consistency warnings the delegate raised.
- Provide a `Known Drift` aggregated section pulling from delegates' deferred-drift notes.
- When the stale set is empty, return `Documentation Sync: no canonical docs require update.` exactly.

See `assets/output.template.md` for the canonical shape; `scripts/lint-output.sh` enforces it.

## Escalate / Stop Conditions

- Stop when `diff-doc-sync` cannot run (missing detector, missing changed-files list).
- Warn when any delegate reports a consistency warning; surface every such warning in the consolidated report rather than swallowing it.
- Do not invent doc paths the detector did not report as stale.
- Do not re-route a path between delegates — the per-domain table in `references/orchestration-rules.md` is the only routing source of truth.

## Resources

- `references/orchestration-rules.md`
- `scripts/route-paths.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/routing-table.txt`
- `agents/openai.yaml`
