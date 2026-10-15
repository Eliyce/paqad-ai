# Consultant, not questionnaire: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `shared/references/consulting.md` | Sections CON-1 to CON-9, with the CON-8 outcome table. CON-1, CON-3 and CON-6 point to the choice prompt rule in `references/voice.md` (TALK-8) |

Not owned here: `skills/shape-idea/references/expert-lenses.md` and `challenge-guide.md` (idea-journey), which expand on CON-3 and CON-4 inside the shaping step; the `assumptions` and `outcome` record blocks (discovery-record).

## Data Contracts

None in this file. The CON-8 outcome values (`build`, `experiment`, `already exists`, `process change`, `defer`, `stop`) are the vocabulary the `outcome` record block uses (REC-1).

## Script Interfaces

None: this feature is instruction-only.

## State Management

None: stateless. The behaviours it asks for write to the discovery record through other modules (CON-1 assumptions, CON-8 outcome).

## Error Codes

None.

## Dependencies

| Kind | Detail |
|---|---|
| Declared by skills (`build/skills.yml`) | `product-discovery`, `ask-project` import `references/consulting.md` |
| Referenced in text | `skills/product-discovery/SKILL.md` names `references/consulting.md`; `skills/ask-project/SKILL.md` cites CON-9 but does not name the file |
| Other modules | conversation-standards voice (talking rules win on how a reply looks) |
| Host capability | Optional web search (CON-7) |

## Configuration

None.

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_record.py` | `AssumptionsTest.test_assumptions_block_stored` (the record side of CON-1, AC-29) |
| `tests/scripts/test_build.py` | `UndeclaredImportTest.test_undeclared_shared_import_fails_build` uses `references/consulting.md` as the undeclared import |

Eval scenarios (declarative, not yet run in CI): `s1.yml` `ac-25` (`labelled-as-suggestion`, `recommendation-plus-choices`), `ac-26` (`already-exists-flagged`, `no-tickets-unless-asked`), `ac-27` (`privacy-risk-raised`), `ac-28` (`smaller-first-step-offered`), `ac-29` (`default-labelled-as-assumption`), `ac-4` (`one-question-at-a-time`). `business-feedback.yml` `ac-68` (choices, challenge and suggested measures in the choice prompt). `tests/scripts/test_conversation_feedback.py` `ChoicePromptTest.test_consulting_con1_names_the_choice_prompt`.
