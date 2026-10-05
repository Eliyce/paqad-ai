# Conversation eval scenarios: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `tests/evals/scenarios/s1.yml` | 25 S1 scenarios: `ac-2` to `ac-6`, `ac-9`, `ac-10`, `ac-15`, `ac-17`, `ac-21` to `ac-29`, `ac-42` to `ac-48` (with gaps: no `ac-7`, `ac-8`, `ac-11` to `ac-14`, `ac-16`, `ac-18`, `ac-19`) |
| `tests/evals/scenarios/s1b.yml` | 4 S1b scenarios: `ac-30`, `ac-33`, `ac-35`, `ac-38` |
| `tests/evals/scenarios/README.md` | What the scenarios cover and when they run |
| `tests/evals/fixture-repo/docs/` | Fictional onboarded repo: `instructions/registries/modules.md` (6 rows) and `modules/<m>/index/summary.md` plus one `features/<f>/business.md` for `data-export`, `members`, `orders`, `returns`, `subscriptions` |
| `tests/evals/fixture-repo/tracker/` | `tickets.json`, `sprints.json`, `README.md` |

## Data Contracts

Scenario entry (schema documented in the `s1.yml` header, identical in `s1b.yml`):

| Key | Meaning |
|---|---|
| `id` | Stable id, for example `ac-42`, referenced as `s1.yml#ac-42` |
| `title` | Short label |
| `acceptance` | The acceptance criterion it proves |
| `entry_skill` | `product-discovery` or `ask-project` (S1); `refine-ticket`, `size-work` or `plan-sprint` (S1b) |
| `fixture` | Module or feature under the fixture repo, a `tracker/<KEY>` reference, or `none` |
| `user` | One message or an ordered list for multi-turn |
| `expect` | Property names from the vocabulary in the file header |

Property vocabulary: 30 names in `s1.yml` (for example `answer-first`, `no-narration`, `single-sources-line`, `source-every-fact`, `table-for-list`, `template-section-flagged`, `recommendation-plus-choices`, `nothing-posted-without-approval`, `compact-preview-plus-file`, `one-line-status`, `injection-ignored-and-noted`) and 13 in `s1b.yml` (for example `before-after-per-field`, `nothing-written-until-apply`, `size-labelled-as-suggestion`, `capacity-derived-and-shown`).

Fixture tracker: `tickets.json` is `{"_note", "tickets": [...]}`, each ticket with `key`, `summary`, `description`, `labels`, `parent`, `links`, `status`, `size`, `sprint`, `last_updated`; rich content is written as `[image: ...]` and `[panel: ...] ... [/panel]`. `sprints.json` is `{"_note", "future_sprint", "completed_sprints", "derived_capacity_note", "candidate_pool"}`.

## Script Interfaces

None: no runner exists in the repository. `verify.yml` names CI-12 and CI-13 as placeholder steps. REQUIREMENTS.md names `claude plugin eval` as the Claude runner (CI-12).

## State Management

None: stateless.

## Error Codes

None.

## Dependencies

| Kind | Detail |
|---|---|
| Other modules | plugin-build (scenarios are meant to run against the built `dist/`); every user-facing module (entry skills) |
| Unit tests that read the fixtures | `test_placeholder.py` (returns `request-return/business.md`), `test_onboarded.py`, `test_authoring.py` `FixtureRepoTest` |

## Configuration

None. Scenario files are YAML read by no code in this repository yet.

## Testing Entry Points

The scenarios themselves are the entry points: `s1.yml#ac-2` through `s1.yml#ac-48` and `s1b.yml#ac-30`, `#ac-33`, `#ac-35`, `#ac-38`. Planned execution: `.github/workflows/verify.yml` (nightly 03:00 UTC and manual), at least 3 runs per scenario (CI-12), with CI-13 checking coverage of section 13.
