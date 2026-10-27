# Command registry

All commands run from the repository root with a Python 3.9+ interpreter (`python3` below).
Standard library only; no install step.

## Developer commands

| Purpose | Command | Notes |
|---|---|---|
| Build the plugin | `python3 build/build.py` | Writes `dist/`; `--dist <dir>` to write elsewhere, `--source <dir>` to build another tree |
| Run all unit tests | `python3 -m unittest discover -s tests/scripts` | CI adds `-p "test_*.py" -v` |
| Run one test file | `python3 -m unittest tests/scripts/test_record.py` | |
| Compile check (the `format` command) | `python3 -m compileall -q build skills tests` | Syntax check, not a formatter |
| Check the build is deterministic | `python3 build/build.py --dist /tmp/a && python3 build/build.py --dist /tmp/b && diff -r /tmp/a /tmp/b` | Same as CI-8 |

`.paqad/project-profile.yaml` maps paqad's `test`, `build` and `format` commands to the rows
above. `install`, `dev`, `lint`, `migrate` and `test_single` are placeholders that print a
message, because no application stack is chosen.

## Skill scripts (run by the host inside a skill, or by hand for debugging)

Each script prints JSON to stdout. Paths below are source paths; in `dist/` every script sits
under its skill's `scripts/` folder.

| Script | Subcommands / key arguments | What it does |
|---|---|---|
| `shared/scripts/record.py` | `init --path [--run-id] [--mode build\|refine\|size\|plan]`, `show --path`, `update --path --expect-revision --patch`, `advance --path --expect-revision`, `approve --path --expect-revision --block --message-ref` | Create, show, patch, advance and approve the discovery record |
| `shared/scripts/check_record.py` | `--path [--step]` | Are the current step's required blocks present and not stale |
| `shared/scripts/check_onboarded.py` | `[--root]` | Readiness check (GRD-1), byte-identical: `ready` or `partly-ready` exit 0, `not-set-up` exit 1. The instructions read these states as the project-docs, docs-and-code and code-only evidence levels (GRD-12); `not-set-up` is the code-only level, not a stop |
| `shared/scripts/find_related.py` | `(--registry \| --modules-dir) --query` | Rank the project's modules against an idea or question, from the registry or, when it is missing, from the area folders and summaries |
| `shared/scripts/detect_placeholder.py` | `--path [--markers]` | Mark each document section as real or template text |
| `shared/scripts/check_prose.py` | `--ticket-set` or `--path`, `[--denylist]` | No dashes, no code words in scoped fields, no deny-list jargon |
| `shared/scripts/check_readback.py` | `--approved --created` | Compare created issues to the approved set |
| `skills/check-tickets/scripts/check_ticket_set.py` | `--ticket-set [--schema]` | Shape, digest and structure checks on a ticket set |
| `skills/post-tickets/scripts/plan_posting.py` | `plan`, `next`, `claim`, `record --operation --receipt`, `reconcile --operation [--tracker-issues]`, all with `--state` | Plan and receipt the posting run; posts nothing itself |
| `skills/post-tickets/scripts/export_csv.py` | `--ticket-set [--out]` | Jira importer CSV export fallback |
| `skills/refine-ticket/scripts/diff_ticket.py` | `--snapshot --proposed [--live]` | Field-by-field change set with conflict and rich-content guards |
| `skills/size-work/scripts/compare_sizes.py` | `suggest --target --pool --scale [--area-docs]`, `set [--field-value] [--replace]` | Size suggestion from comparables; guard a size-field write |
| `skills/plan-sprint/scripts/fit_sprint.py` | `plan --sprint-field --candidates --history [--target-sprint]`, `apply --plan --expect-digest [--tracker-state]` | Propose a sprint fit; apply to the chosen set only |

## CI workflows

| Workflow | Trigger | Runs today |
|---|---|---|
| `.github/workflows/ci.yml` | pull request, manual | CI-7 unit tests (no coverage gate), CI-8 deterministic build. Others are labelled placeholders |
| `.github/workflows/verify.yml` | nightly 03:00 UTC, manual | Placeholders only (CI-12, CI-13) |
| `.github/workflows/release.yml` | manual | Placeholders only (CI-14, CI-15) |
