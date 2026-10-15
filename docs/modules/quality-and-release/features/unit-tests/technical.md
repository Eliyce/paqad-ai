# Script and authoring tests: technical

## Module Boundaries

`tests/scripts/` (17 files). Each file puts the script folders it needs on `sys.path` (`shared/scripts`, `build`, `tests/ci`, `tests/evals`, or a skill's `scripts/`). The table says what each file covers rather than how many tests it holds, since the count moves with every change; run the suite for the current number.

| File | Subject | Proves (as cited in the file) |
|---|---|---|
| `test_authoring.py` | Source tree | Frontmatter and size, flat references, voice block, vendor names, dashes, fixture repo, trigger hygiene, checklist fallback, capability fallback (U-1), doc-access branch (GRD-3), record file-vs-chat-summary (REC-2), post-tickets link fallback (U-3), GitHub profile, vendor-scan scope; the shared repository rule (selection cues, four marks, both sentences taken from `check_onboarded.py`, at most 100 lines, no skill-local copy), who declares it and the check script, the single-source pointer in the reading skills, the frozen `ask-project` description and its rejection of planted bad descriptions, the record's `setup.repository` fields, the three-state by-hand checklists, the REQUIREMENTS v2.4 markers |
| `test_build.py` | `build/build.py` | Manifests, extension key, voice and GitHub profile copies, forbidden content, no bytecode, determinism, undeclared import, per-host branches (PLG-12), homepage; `connect-repository.md` in exactly the five declaring skills and `check_onboarded.py` in exactly the three, byte-identical to the source, and an undeclared `connect-repository.md` failing the build |
| `test_bump_version.py` | `build/bump_version.py` | CI-14 version bump from changesets: patch, minor, major, highest wins, only the version line changes, byte-identical rebuild, dry run writes nothing, a missing or README-only changeset fails |
| `test_canonical.py` | `shared/scripts/canonical.py` | Digest determinism and key order, NaN refused, helpers |
| `test_check_record.py` | `shared/scripts/check_record.py` | AC-15 resume signal, guards, CLI, mode-aware checks, sync with `record.py` |
| `test_ci_checks.py` | `tests/ci/*.py` | Forbidden content, unit budget, secrets scan, section 13 scenario coverage (including AC-49 to AC-56 from `repo-selection.yml` and `test_onboarded.py`, and AC-57 to AC-61 from `evidence-rules.yml`), CI tooling not shipped, guarded public release, host verdict files |
| `test_record.py` | `shared/scripts/record.py` | Init, revision refusal, go-back staleness (AC-7), invalidation map, assumptions (AC-29), advance gate, refine, size and plan modes, approvals |
| `test_find_related.py` | `shared/scripts/find_related.py` | Registry path: parse, rank, ties, CLI. Modules-folder path: rows from the area summaries in the registry row shape, skipped missing and empty summaries, `plain_name` fallback, deterministic sorted-folder ties, the `--modules-dir` CLI with its exit 1 paths (missing folder, a file, no summaries) and the exit 2 usage errors |
| `test_placeholder.py` | `shared/scripts/detect_placeholder.py` | Real markers file, fixture doc real and template sections, intro prose not loaded as markers |
| `test_onboarded.py` | `shared/scripts/check_onboarded.py` | GRD-1 three states: ready on the real fixture with the exact payload, partly ready (modules list missing, whitespace-only or a folder) with the exact message, unknown areas (missing, empty, whitespace-only, invalid UTF-8 summaries), not set up trees (AC-56) with the stop message byte for byte, sorted order ignoring hidden entries, the `OSError` paths (unlistable folder, unstattable file, unreadable summary), usage error exit 2 |
| `test_tickets.py` | `check_prose.py`, `skills/check-tickets/scripts/check_ticket_set.py` | AC-8, TKT-3, TKT-4, section 8.5 structure failures |
| `test_posting.py` | `plan_posting.py`, `check_readback.py`, `export_csv.py` | AC-11 to AC-14, AC-18, read-back for ticket and change sets, CSV and Markdown export, links-by-hand fallback (U-3), external dependencies |
| `test_refine.py` | `skills/refine-ticket/scripts/diff_ticket.py` | AC-31 to AC-34, EDT-4, EDT-9 |
| `test_sizing.py` | `skills/size-work/scripts/compare_sizes.py` | AC-35 to AC-37, EST-2, EST-3 |
| `test_sprint.py` | `skills/plan-sprint/scripts/fit_sprint.py` | AC-38 to AC-41, SPR-6, SPR-7, U-14 |
| `test_evidence_rules.py` | `shared/references/paqad-docs-map.md`, the five declaring skills, `build/build.py`, `REQUIREMENTS.md`, `tests/evals/scenarios/evidence-rules.yml`, the fixture | What the documents prove (GRD-8 to GRD-11, ASK-8): the section carries every amended rule and phrase (the GRD-8 example phrasings, "in any wording", the exact thing a status names, the menu-entry rule, requirements only outside `docs/modules`, business notes always current, one "the code suggests" line per area, `.git/`, `vendor/` and `node_modules/` on the never-read list) with the retired "must or should" and "that same area" wording gone, and planted copies report a dropped rule, a retired phrase and a missing section; row 7 automatic, no requirements row, both onboarded sentences verbatim and at most 100 lines; exactly five declarers (and the three non-declarers without it), each pointing to the section, bodies at most 150 lines; the four by-hand checklist bullets are one shared text and drift is caught; the old "may look", "material gap", "Only if it is attached" and "never not built" wording gone; a fresh build ships the docs map byte-identical into exactly the declarers and an undeclared mention fails it; the partly ready not documented line and step 1 of `get-connected` and `ask-project`; the answer, playback and record templates (`today` `code_suggests` and `code_source_path`); the REQUIREMENTS ids, ASK-8 as a MUST, the amended GRD-8 to GRD-11 text and no dash; the loyalty, referrals and `vendor/points-kit` stubs without area notes, every stub neutral, the stale "soon" line, the business-note "must" rule, the neutral `Requirements.md`, `LOY-12`, and the fixture still ready with no unknown areas; the scenario header (the "states or implies, in any wording" definition and the four new properties) and `ac-59b` and `ac-60c` (17 tests) |
| `test_parity.py` | `tests/evals/run_parity.py` | AC-20 offline structural parity: passes on the real dist, fails loudly on a missing skill, a divergent ticket-set schema, a malformed ticket-set, or a missing branch |

## Data Contracts

None of its own. Tests build inputs inline or read real files: `shared/references/template-markers.md`, `shared/references/plain-language.md`, `shared/references/connect-repository.md`, `shared/references/paqad-docs-map.md`, the skills' `SKILL.md` and reference templates, `build/skills.yml`, `REQUIREMENTS.md`, `tests/evals/scenarios/`, and `tests/evals/fixture-repo/`.

## Script Interfaces

| Command | Notes |
|---|---|
| `python3 -m unittest discover -s tests/scripts` | All tests (CI adds `-p "test_*.py" -v`) |
| `python3 -m unittest tests/scripts/test_record.py` | One file |

Exit 0 when all pass, 1 otherwise (standard `unittest`).

## State Management

None: stateless. Tests write only under `tempfile` folders.

## Error Codes

None. Failures are standard `unittest` assertion messages.

## Dependencies

| Kind | Detail |
|---|---|
| Python | 3.9+, standard library only (`unittest`, `unittest.mock`, `tempfile`, `json`, `csv`, `io`, `glob`, `re`) |
| Other modules | Every script-bearing module; plugin-build (`build.build`, `build.parse_skills_yml`) |

## Configuration

Constants in `test_authoring.py` that must track the spec: `ENTRY_SKILLS` (5), `SCRIPT_BEARING_SKILLS` (9), `STEP_PHRASE = "journey directs it"`, `VENDOR_PATTERN`, `TEMPLATE_MARKERS` (a copy of the ten GRD-4 markers), and the dash-scan roots (`skills`, `shared`, `hosts`, `build`, `tests`, `.github`, `.changeset`). The vendor/host-name scan (CI-4) is scoped to `skills/` and `shared/`: host names are allowed in the build generator and tests (they name the per-host branches) but not in shipped skill or shared text.

The AC numbers in `test_authoring.py` (AC-1, AC-10 to AC-13) follow the S0 slice spec numbering, not section 13 of REQUIREMENTS.md.

## Testing Entry Points

`test_authoring.py`: `SkillFrontmatterTest.test_each_skill`, `VoiceBlockTest.test_each_skill_opens_with_voice_block`, `NeutralWordingTest.test_no_vendor_names`, `HousePromptTest.test_no_em_or_en_dash`, `FixtureRepoTest.test_onboarded_layout`, `FixtureRepoTest.test_business_md_has_real_and_template_sections`, `TriggerHygieneTest.test_entry_skills_present`, `TriggerHygieneTest.test_entry_and_step_descriptions`, `ChecklistFallbackTest.test_script_bearing_set_is_detected`, `ChecklistFallbackTest.test_each_script_bearing_skill_has_fallback`, `CapabilityFallbackTest` (U-1), `DocAccessBranchTest.test_both_reading_skills_carry_the_branch` (GRD-3), `RecordFallbackTest.test_product_discovery_states_file_vs_chat_summary` (REC-2), `PostLinkFallbackTest.test_post_tickets_carries_link_fallback` (U-3), `GithubProfileTest`, `VendorScanScopeTest` (CI-4 scope), `OneLevelReferenceTest`, `RepositorySelectionTest`, `RepositoryDeclarationTest`, `SingleSourceDocAccessTest`, `AskProjectTriggerTest`, `RecordRepositoryFieldsTest`, `ThreeStateChecklistTest`, `RequirementsV24Test`.

Other files' test names are listed in the technical docs of the module each script belongs to. Run in CI by the "CI-7 script tests (partial, no coverage gate yet)" step of `.github/workflows/ci.yml`.
