# Understand the idea: technical

## Module Boundaries

| Path | Owned |
|---|---|
| `skills/understand-idea/SKILL.md` | Yes: step 1 procedure and checklist |
| `skills/understand-idea/references/question-bank.md` | Yes: grounded questions per gap (goal, who benefits, success, constraints) |
| `skills/understand-idea/references/success-prompts.md` | Yes: suggested measures when success is unknown |

Step skill (PLG-8). Ships no script and declares no shared script, so it is not in `SCRIPT_BEARING_SKILLS`.

## Data Contracts

Produces content for three blocks (written by `product-discovery` through `record.py update`):

| Block | Shape |
|---|---|
| `idea` | `{goal, who_benefits, success, constraints}` |
| `assumptions` | `[{id, question, default, why}]` for accepted defaults and accepted suggested measures |
| `glossary` | `[{user_term, project_term}]` |

## Script Interfaces

None: this feature is instruction-only.

## State Management

`idea` is the step 1 required block (`record.REQUIRED[1]`) and the head of the go-back chain: changing it stales `today`, `playback`, `decisions`, `ticket_set_ref`, `readiness` and `posted`. `assumptions` and `glossary` are outside the chain and survive a goal change.

## Error Codes

None.

## Dependencies

| Kind | Item |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md` |
| Modules | conversation-standards, discovery-record (via the coordinator) |
| Host capabilities | Chat only |

## Configuration

None.

## Testing Entry Points

| Kind | Entry point |
|---|---|
| Eval scenarios (`s1.yml`) | `ac-3` (`no-reask`), `ac-4` (`one-question-at-a-time`), `ac-25` (`labelled-as-suggestion`, `recommendation-plus-choices`), `ac-29` (`default-labelled-as-assumption`) |
| Unit | `tests/scripts/test_record.py::GoBackTest` (idea change stales the chain), `AssumptionsTest::test_assumptions_block_stored` |
| Authoring | `tests/scripts/test_authoring.py::TriggerHygieneTest` (AC-19) |
