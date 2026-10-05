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
| TD-6 | Placeholder homepage `https://example.invalid/paqad-product-discovery` | `build/skills.yml` | Low now; would ship in manifests on release | Set the real homepage before the first release |
| TD-7 | Release is not automated; version fixed at `0.0.0`; no `CHANGELOG.md`; no real changesets | `.github/workflows/release.yml`, `.changeset/` | Medium at release time (CI-14, CI-15) | S3 |
| TD-8 | Laravel stack rules and tool docs are installed although this repo has no Laravel code | `docs/instructions/rules/coding/stacks/laravel/` (12 files), `docs/instructions/tools/laravel/` | Low. Irrelevant rules can be loaded during feature work and add noise | Remove the Laravel stack pack from this project's paqad setup, or confirm it is intentional |
| TD-9 | `.paqad/project-profile.yaml` keeps placeholder `install`, `dev`, `lint`, `test_single`, `migrate` commands | `.paqad/project-profile.yaml` | Low | Point `test_single` at `python3 -m unittest <file>`; leave the others as explicit no-ops |
| TD-10 | `build.py` parses a restricted YAML subset by hand | `build/build.py` | Low. Deliberate (stdlib only), but unusual YAML in `skills.yml` fails with a line error | Keep `skills.yml` in the documented flat shape; the parser's errors name the line |
| TD-11 | ChatGPT and Codex parity not built | REQUIREMENTS.md section 14 | Planned | S2 |
