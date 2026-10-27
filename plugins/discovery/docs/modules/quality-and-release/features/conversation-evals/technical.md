# Conversation eval scenarios: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `tests/evals/scenarios/s1.yml` | 25 S1 scenarios: `ac-2` to `ac-6`, `ac-9`, `ac-10`, `ac-15`, `ac-17`, `ac-21` to `ac-29`, `ac-42` to `ac-48` (with gaps: no `ac-7`, `ac-8`, `ac-11` to `ac-14`, `ac-16`, `ac-18`, `ac-19`) |
| `tests/evals/scenarios/s1b.yml` | 4 S1b scenarios: `ac-30`, `ac-33`, `ac-35`, `ac-38` |
| `tests/evals/scenarios/repo-selection.yml` | 8 scenarios for choosing the repository, the readiness check read as the evidence levels and the wider `ask-project` trigger: `ac-49` to `ac-55` plus `ac-53b`, with `ac-53` and `ac-53b` now answering a code-only repository from code with the source line rather than stopping |
| `tests/evals/scenarios/generic-mode.yml` | 8 scenarios for generic mode (GM-1 to GM-9, GRD-12 to GRD-16): the three evidence levels, the one source line per level, the only stop (nothing readable), the at-most-once informational nudge and a code-only size; `gm-1`, `gm-56`, `gm-62`, `gm-63`, `gm-64`, `gm-65`, `gm-66`, `gm-67` covering AC-1, AC-53, AC-56 and AC-62 to AC-67. The file-level rules behind them are proven by `tests/scripts/test_generic_mode.py` |
| `tests/evals/scenarios/evidence-rules.yml` | 11 scenarios for what the documents prove and the automatic code check (GRD-8 to GRD-11, ASK-8): `ac-57`, `ac-57b`, `ac-57c`, `ac-58`, `ac-59`, `ac-59b` (referrals, a second undocumented area with no status of its own), `ac-60`, `ac-60b`, `ac-60c` (a business-note rule worded as must, read as current behaviour), `ac-61`, `ac-61b`, covering AC-57 to AC-61. The file-level rules behind them are proven by `tests/scripts/test_evidence_rules.py` |
| `tests/evals/scenarios/s2.yml` | S2 ChatGPT and Codex parity scenarios (AC-20): one per entry point plus a capability-stripped variant, with `capability_set` and `requirements` fields and `hosts`/`manual_hosts` headers |
| `tests/evals/run_parity.py` | Offline structural-parity harness for AC-20: reads `s2.yml`, the built per-host branches under `dist/hosts/<host>/`, the fixture repo and fake tracker, and checks same-journey, same-answer-structure and same-ticket-set across hosts |
| `tests/evals/scenarios/README.md` | What the scenarios cover and when they run |
| `tests/evals/fixture-repo/docs/` | Fictional paqad-documented repo (the project-docs level): `instructions/registries/modules.md` (7 rows) and `modules/<m>/index/summary.md` plus one `features/<f>/business.md` for `data-export`, `members`, `orders`, `returns`, `subscriptions`. The `loyalty` and `referrals` rows have no `docs/modules` folder, so the repo stays ready with no unknown areas. The `members` summary ends with one stale line, "The account page also lists loyalty points as an entry marked soon.", and never mentions referrals. The `manage-account` business note states one rule that must hold, "An account must confirm its email address before its first sign-in." Dropping `instructions/registries/modules.md` gives the docs-and-code level |
| `tests/evals/fixture-repo-code-only/` | Fictional repository with real code and no paqad docs (the code-only level): `app/Bookings/` and `app/Reminders/` with `Models/`, `Actions/`, `Pages/` and `Routes/` `.php` files, and `tests/Bookings/`, `tests/Reminders/` test files. No `docs/instructions/registries/modules.md` and no `docs/modules`, so the GRD-11 code-only finder builds the whole what-exists answer from the names. Never executed |
| `tests/evals/fixture-repo/app/Loyalty/`, `tests/evals/fixture-repo/tests/Loyalty/` | Four invented `.php` stubs (`Actions/EarnPoints.php`, `Actions/RedeemPoints.php`, `Pages/PointsBalance.php`, `EarnPointsTest.php`): the loyalty code with no notes that the GRD-11 code check reads. Never executed |
| `tests/evals/fixture-repo/app/Referrals/`, `tests/evals/fixture-repo/tests/Referrals/` | Three invented `.php` stubs (`Actions/InviteFriend.php`, `Actions/RewardReferrer.php`, `InviteFriendTest.php`): a second undocumented area with code and no status in any document, for `ac-59b`. Never executed |
| `tests/evals/fixture-repo/vendor/points-kit/` | One invented vendored stub (`src/PointsTransfer.php`) that describes transferring points, inside a folder on the GRD-11 never-read list, for `never-read-paths-skipped`. Never executed |
| `tests/evals/fixture-repo/Requirements.md` | An invented requirements document whose only hint about its nature is "Status: baseline for technical design." (no pre-build or not-real wording), including gifting points, which no area code supports: the GRD-10 intent-only case |
| `tests/evals/fixture-repo/tracker/` | `tickets.json`, `sprints.json`, `README.md`. `LOY-12` ("Let members gift points") claims loyalty is not built yet, for the refine and size evidence scenarios |

## Data Contracts

Scenario entry (schema documented in the `s1.yml` header, identical in `s1b.yml`, `repo-selection.yml`, `evidence-rules.yml` and `generic-mode.yml`):

| Key | Meaning |
|---|---|
| `id` | Stable id, for example `ac-42`, referenced as `s1.yml#ac-42` |
| `title` | Short label |
| `acceptance` | The acceptance criterion it proves |
| `entry_skill` | `product-discovery` or `ask-project` (S1); `refine-ticket`, `size-work` or `plan-sprint` (S1b) |
| `fixture` | Module or feature under the fixture repo, a `tracker/<KEY>` reference, or `none`. `evidence-rules.yml` adds `fixture-repo` (the whole fixture, code reachable), `fixture-repo docs folder only` (code not reachable) and `tracker/LOY-12, fixture-repo` |
| `user` | One message or an ordered list for multi-turn |
| `expect` | Property names from the vocabulary in the file header |
| `repositories` | `repo-selection.yml` only: the repositories the user can reach, as plain `<name>, <state>, <activity>` scalars, or the single scalar `no listing tool`; omitted when the repository is attached. No scalar holds a colon followed by a space, so `run_parity.py`'s reader parses it |

Property vocabulary: 30 names in `s1.yml` (for example `answer-first`, `no-narration`, `single-sources-line`, `source-every-fact`, `table-for-list`, `template-section-flagged`, `recommendation-plus-choices`, `nothing-posted-without-approval`, `compact-preview-plus-file`, `one-line-status`, `injection-ignored-and-noted`) and 13 in `s1b.yml` (for example `before-after-per-field`, `nothing-written-until-apply`, `size-labelled-as-suggestion`, `capacity-derived-and-shown`). `repo-selection.yml` adds 16 (for example `overview-table-of-areas`, `no-repository-question`, `one-choice-list`, `most-recent-first`, `each-repository-marked`, `one-recommended-with-reason`, `onboarding-sentence-exact`, `partly-ready-said-once`, `unknown-areas-named`) and reuses the `s1.yml` vocabulary. `evidence-rules.yml` adds 17 (`not-documented-said`, `no-not-built-claim` (nothing states or implies, in any wording, that the feature is missing; the GRD-8 phrases are examples, not the test), `code-suggests-labelled`, `code-checked-for-that-area-only`, `docs-status-reported-as-docs`, `docs-status-not-generalised`, `docs-and-code-both-said`, `spec-not-presented-as-current`, `spec-labelled-as-intended`, `at-most-one-offer-line`, `today-entry-code-line-labelled`, `no-new-area-driver-from-missing-docs`, `confidence-lowered-and-said`, `menu-tag-not-feature-status`, `business-note-used-as-current`, `one-code-line-per-area`, `never-read-paths-skipped`) and reuses the `s1.yml`, `s1b.yml` and `repo-selection.yml` vocabulary. `generic-mode.yml` adds 9 (`source-line-present`, `level-from-project-docs`, `level-from-docs-and-code`, `level-from-code-only`, `no-not-built-claim-code-only`, `answers-at-best-level`, `stops-only-when-nothing-readable`, `nudge-at-most-once`, `nudge-informational-only`) and reuses the `s1.yml`, `s1b.yml`, `repo-selection.yml` and `evidence-rules.yml` vocabulary.

Fixture tracker: `tickets.json` is `{"_note", "tickets": [...]}`, each ticket with `key`, `summary`, `description`, `labels`, `parent`, `links`, `status`, `size`, `sprint`, `last_updated`; rich content is written as `[image: ...]` and `[panel: ...] ... [/panel]`. `sprints.json` is `{"_note", "future_sprint", "completed_sprints", "derived_capacity_note", "candidate_pool"}`.

## Script Interfaces

No runner exists for the conversational scenarios in `s1.yml` / `s1b.yml`; `verify.yml` names CI-12 and CI-13 as placeholder steps, and REQUIREMENTS.md names `claude plugin eval` as the Claude runner (CI-12). The structural half of the S2 parity scenarios (`s2.yml`) is the exception: `tests/evals/run_parity.py` (`check_parity`) runs offline in the unit suite via `tests/scripts/test_parity.py` against the built per-host branches, the fixture repo and the fake tracker. The live conversational parity on ChatGPT and Codex stays manual and recorded per CI-12 (`manual_hosts` in `s2.yml`).

## State Management

None: stateless.

## Error Codes

None.

## Dependencies

| Kind | Detail |
|---|---|
| Other modules | plugin-build (scenarios are meant to run against the built `dist/`); every user-facing module (entry skills) |
| Unit tests that read the fixtures | `test_placeholder.py` (returns `request-return/business.md`), `test_onboarded.py` (the real fixture is ready; temp copies give partly ready and not set up), `test_find_related.py` (`--modules-dir` on the fixture `docs/modules`), `test_authoring.py` `FixtureRepoTest`, `test_evidence_rules.py` `EvidenceFixtureTest` (the loyalty, referrals and `vendor/points-kit` stubs without area notes, every stub neutral, the stale line, the business-note rule, the neutral `Requirements.md`, `LOY-12`, still ready with no unknown areas) and `EvidenceScenariosTest` (the `evidence-rules.yml` header and `ac-59b`, `ac-60c`), and `test_generic_mode.py` `CodeOnlyFixtureTest` (the `fixture-repo-code-only` tree has real code with meaningful folder, route, page, action, model and test names and no paqad docs) |

## Configuration

None. Scenario files are YAML read by no code in this repository yet.

## Testing Entry Points

The scenarios themselves are the entry points: `s1.yml#ac-2` through `s1.yml#ac-48`, `s1b.yml#ac-30`, `#ac-33`, `#ac-35`, `#ac-38`, `repo-selection.yml#ac-49` through `#ac-55` plus `#ac-53b`, `evidence-rules.yml#ac-57` through `#ac-61b`, and the S2 parity scenarios in `s2.yml` (AC-20). Planned execution for the conversational scenarios: `.github/workflows/verify.yml` (nightly 03:00 UTC and manual), at least 3 runs per scenario (CI-12), with CI-13 checking coverage of section 13. The S2 structural parity runs today in the unit suite: `tests/scripts/test_parity.py` (`ParityHarnessTest`: `test_passes_on_the_real_dist`, `test_fails_when_a_host_branch_is_missing_a_skill`, `test_fails_when_a_branch_ticket_schema_diverges`, `test_fails_on_a_malformed_ticket_set`, `test_fails_when_a_whole_branch_is_missing`).
