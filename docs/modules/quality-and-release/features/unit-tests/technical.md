# Script and authoring tests: technical

## Module Boundaries

`tests/scripts/` (13 files, 154 tests). Each file puts the script folders it needs on `sys.path` (`shared/scripts`, `build`, or a skill's `scripts/`).

| File | Tests | Subject | Proves (as cited in the file) |
|---|---|---|---|
| `test_authoring.py` | 10 | Source tree | Frontmatter and size, voice block, vendor names, dashes, fixture repo, trigger hygiene, checklist fallback |
| `test_build.py` | 8 | `build/build.py` | Manifests, extension key, voice copy, forbidden content, no bytecode, determinism, undeclared import |
| `test_canonical.py` | 12 | `shared/scripts/canonical.py` | Digest determinism and key order, NaN refused, helpers |
| `test_check_record.py` | 13 | `shared/scripts/check_record.py` | AC-15 resume signal, guards, CLI, mode-aware checks, sync with `record.py` |
| `test_record.py` | 31 | `shared/scripts/record.py` | Init, revision refusal, go-back staleness (AC-7), assumptions (AC-29), advance gate, approvals |
| `test_find_related.py` | 8 | `shared/scripts/find_related.py` | Parse, rank, ties, CLI |
| `test_placeholder.py` | 6 | `shared/scripts/detect_placeholder.py` | Real markers file, fixture doc real and template sections |
| `test_onboarded.py` | 7 | `skills/get-connected/scripts/check_onboarded.py` | GRD-1, AC-1 exact message |
| `test_tickets.py` | 14 | `check_prose.py`, `skills/check-tickets/scripts/check_ticket_set.py` | AC-8, TKT-3, section 8.5 structure failures |
| `test_posting.py` | 16 | `plan_posting.py`, `check_readback.py`, `export_csv.py` | AC-11 to AC-14, AC-18, read-back, CSV columns |
| `test_refine.py` | 10 | `skills/refine-ticket/scripts/diff_ticket.py` | AC-31 to AC-34, EDT-4, EDT-9 |
| `test_sizing.py` | 11 | `skills/size-work/scripts/compare_sizes.py` | AC-35 to AC-37, EST-2, EST-3 |
| `test_sprint.py` | 8 | `skills/plan-sprint/scripts/fit_sprint.py` | AC-38 to AC-41, SPR-6, SPR-7, U-14 |

## Data Contracts

None of its own. Tests build inputs inline or read real files: `shared/references/template-markers.md`, `shared/references/plain-language.md`, `build/skills.yml`, and `tests/evals/fixture-repo/`.

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
| Python | 3.9+, standard library only (`unittest`, `tempfile`, `json`, `csv`, `io`, `glob`, `re`) |
| Other modules | Every script-bearing module; plugin-build (`build.build`, `build.parse_skills_yml`) |

## Configuration

Constants in `test_authoring.py` that must track the spec: `ENTRY_SKILLS` (5), `SCRIPT_BEARING_SKILLS` (9), `STEP_PHRASE = "journey directs it"`, `VENDOR_PATTERN`, `TEMPLATE_MARKERS` (a copy of the ten GRD-4 markers), and the dash-scan roots (`skills`, `shared`, `hosts`, `build`, `tests`, `.github`, `.changeset`).

The AC numbers in `test_authoring.py` (AC-1, AC-10 to AC-13) follow the S0 slice spec numbering, not section 13 of REQUIREMENTS.md.

## Testing Entry Points

`test_authoring.py`: `SkillFrontmatterTest.test_each_skill`, `VoiceBlockTest.test_each_skill_opens_with_voice_block`, `NeutralWordingTest.test_no_vendor_names`, `HousePromptTest.test_no_em_or_en_dash`, `FixtureRepoTest.test_onboarded_layout`, `FixtureRepoTest.test_business_md_has_real_and_template_sections`, `TriggerHygieneTest.test_entry_skills_present`, `TriggerHygieneTest.test_entry_and_step_descriptions`, `ChecklistFallbackTest.test_script_bearing_set_is_detected`, `ChecklistFallbackTest.test_each_script_bearing_skill_has_fallback`.

Other files' test names are listed in the technical docs of the module each script belongs to. Run in CI by the "CI-7 script tests (partial, no coverage gate yet)" step of `.github/workflows/ci.yml`.
