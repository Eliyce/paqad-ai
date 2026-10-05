# Tech debt

Found during the 2026-10-05 documentation run. Ordered by impact. Items that are planned slice
work (S2, S3) are listed so they stay visible, not because they are mistakes.

| ID | Item | Where | Impact | Suggested fix |
|---|---|---|---|---|
| TD-1 | Most PR checks are placeholders: CI-1 to CI-6, CI-9, CI-10, CI-11, CI-20 print "not yet implemented" | `.github/workflows/ci.yml` | High. Several rules (size budget, forbidden folders, secrets, official validators) are unguarded on PRs. Some are partly covered because `test_authoring.py` runs inside CI-7 (frontmatter, vendor names, dashes, voice block) | S3: wire each check; meanwhile, relabel the steps already covered by `test_authoring.py` so CI does not under-report |
| TD-2 | No branch-coverage gate (90%) and no standard-library-only import check | `.github/workflows/ci.yml` (CI-7) | Medium. The stdlib-only promise (PLG-5) is unchecked | Add a stdlib `trace`-based or allow-list import check; coverage gate in S3 |
| TD-3 | Conversation evals are authored but never run | `tests/evals/scenarios/s1.yml`, `s1b.yml`; `.github/workflows/verify.yml` | High for product quality. TALK-* and CON-* rules are unverified | S3: run CI-12 against `dist/` |
| TD-4 | `verify.yml` and `ci.yml` comments are stale: they say "no scenarios exist yet" and describe S0, but S1 and S1b scenarios exist | `.github/workflows/verify.yml`, `.github/workflows/ci.yml` | Low. Misleads readers about status | Update the comments to the current slice |
| TD-5 | Host verdicts are all `pending` (32 rows: 9 claude.ai, 13 ChatGPT, 10 Codex) | `hosts/claude.md`, `hosts/chatgpt.md`, `hosts/codex.md` | High for release. Support cannot be claimed (CI-19) | Install on each host and record verdicts |
| TD-6 | Placeholder homepage `https://example.invalid/paqad-product-discovery` | `build/skills.yml` | Low. `build.py` never writes `homepage` into any manifest, so the value is unused today | Set the real homepage, and decide whether the manifests should carry it |
| TD-7 | Release is not automated; version fixed at `0.0.0`; no `CHANGELOG.md`; no real changesets | `.github/workflows/release.yml`, `.changeset/` | Medium at release time (CI-14, CI-15) | S3 |
| TD-8 | Laravel stack rules and tool docs are installed although this repo has no Laravel code | `docs/instructions/rules/coding/stacks/laravel/` (12 files), `docs/instructions/tools/laravel/` | Low. Irrelevant rules can be loaded during feature work and add noise | Remove the Laravel stack pack from this project's paqad setup, or confirm it is intentional |
| TD-9 | `.paqad/project-profile.yaml` keeps placeholder `install`, `dev`, `lint`, `test_single`, `migrate` commands | `.paqad/project-profile.yaml` | Low | Point `test_single` at `python3 -m unittest <file>`; leave the others as explicit no-ops |
| TD-10 | `build.py` parses a restricted YAML subset by hand | `build/build.py` | Low. Deliberate (stdlib only), but unusual YAML in `skills.yml` fails with a line error | Keep `skills.yml` in the documented flat shape; the parser's errors name the line |
| TD-11 | ChatGPT and Codex parity not built | REQUIREMENTS.md section 14 | Planned | S2 |

## Found during module documentation (2026-10-05)

"Verified" means re-checked against the source after the module docs were written. "Reported"
means found while reading the source for the module docs and not yet independently re-checked.

| ID | Item | Where | State | Impact |
|---|---|---|---|---|
| TD-12 | FIXED (2026-10-05): `check_readback.py` now recognises a refine change set (`changes[]`, no `epics[]`) and compares only the changed fields of the edited ticket plus any new children, honouring replace vs append ops and never flagging extra. The post-tickets ticket-set path is unchanged | `shared/scripts/check_readback.py`, `tests/scripts/test_posting.py` | Fixed | Was high: the EDT-10 read-back guarantee did not work as scripted |
| TD-13 | `detect_placeholder.load_markers` treats every non-heading line of `template-markers.md` as a marker, including the explanatory prose, so a real section containing words like "loader." is marked as template | `shared/scripts/detect_placeholder.py`, `shared/references/template-markers.md` | Verified | Medium: real documentation can be reported as unknown |
| TD-14 | `check_ticket_set.py` accepts `--schema` but never uses it; title length, ref patterns and extra properties are not checked; a `depends_on` on an existing tracker issue is flagged `DANGLING_DEPENDENCY` while `plan_posting.py` silently skips it | `skills/check-tickets/scripts/check_ticket_set.py`, `skills/post-tickets/scripts/plan_posting.py` | Reported | Medium |
| TD-15 | `compare_sizes.py suggest` raises an uncaught IndexError when no comparable ticket has a size | `skills/size-work/scripts/compare_sizes.py` | Reported | Medium |
| TD-16 | `fit_sprint.py apply` reads back from an optional `--tracker-state` file that SKILL.md never mentions; without it the read-back always reports mismatch. The plan's chosen list is `fitting` in the script and `chosen` in REC-1 and the record tests, and the two digest functions exclude different keys | `skills/plan-sprint/scripts/fit_sprint.py`, `shared/scripts/record.py` | Reported | Medium |
| TD-17 | Fixture and script shapes disagree: `tracker/sprints.json` uses `completed_sprints[].completed`, `fit_sprint.py` expects `history.sprints[].delivered` | `tests/evals/fixture-repo/tracker/sprints.json` | Reported | Low until evals run |
| TD-18 | Record template lags the code: no `existing`, `changes`, `sizing`, `sprint_plan` blocks, and `posted.read_back` is `""` while `new_record()` uses `{}`; a fresh record's seeded `posted` counts as present, so step 6 reads satisfied | `skills/product-discovery/assets/record-template.md`, `shared/scripts/record.py` | Reported | Medium |
| TD-19 | Docs disagree with code: `journey.md` go-back map omits `ticket_set_ref -> readiness` (code does it on purpose, INV-11); `product-discovery/SKILL.md` says `check_record.py` checks the revision, it does not; no step skill says who fills `outcome`, which step 4 requires | `skills/product-discovery/`, `skills/decide-together/SKILL.md` | Reported | Medium |
| TD-20 | Not scripted although the spec implies it: TKT-4 (sentences over 30 words), Markdown export (PUB-8), PUB-4 labels on story rows in the CSV, link-direction check (PUB-3), two SPR-4 risks | `shared/scripts/check_prose.py`, `skills/post-tickets/scripts/export_csv.py`, `skills/plan-sprint/scripts/fit_sprint.py` | Reported | Low to medium; the written checklists still cover them |
| TD-21 | `references/tracker-profiles/jira.md` ships two levels deep, against PLG-3 and CI-2 (one level) | `shared/references/tracker-profiles/` | Reported | Low; may fail CI-2 once wired |
| TD-22 | Requirement ID drift: tests use S0 slice ids (AC-1, AC-10 to AC-13, FR-*) that clash with REQUIREMENTS.md section 13; GRD-4 names `shared/template-markers.md`; section 6.2 places the record scripts under `product-discovery/scripts` | `tests/scripts/`, `REQUIREMENTS.md` | Reported | Low |
| TD-23 | The paqad orphan-directory script only reads top-level `slug:` keys, so it reports every module in this list-form map as an orphan | paqad `documentation-workflow/scripts/list-orphan-module-dirs.sh` | Verified | Low: false positives only |
