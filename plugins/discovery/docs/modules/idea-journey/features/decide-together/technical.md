# Settle open choices: technical

## Module Boundaries

| Path | Owned |
|---|---|
| `skills/decide-together/SKILL.md` | Yes: step 4 procedure and checklist |
| `skills/decide-together/references/decision-template.md` | Yes: decision and assumption field definitions |

Step skill (PLG-8). No script; not script-bearing.

## Data Contracts

Produces two blocks (written by `product-discovery` through `record.py update`):

| Block | Shape | Id convention |
|---|---|---|
| `decisions` | `[{id, question, choice, by, why}]` | `D1`, `D2`, ... |
| `assumptions` | `[{id, question, default, why}]` | `A1`, `A2`, ... |

`journey.md` and `record.REQUIRED[4]` also require the `outcome` block (`{type, reason, next_action}`, type per CON-8) to exit step 4. `decide-together/SKILL.md` does not say it fills `outcome`; which skill produces it is not stated in the step skills.

## Script Interfaces

None: this feature is instruction-only.

## State Management

Reads `playback`. Step 4 requires `decisions` and `outcome` present and not stale before `record.py advance`. Changing `decisions` stales `ticket_set_ref`, `readiness`, `posted`. `assumptions` and `outcome` are outside the go-back chain, so they survive a goal change (`test_unrelated_decision_survives_a_goal_change` checks `assumptions`).

## Error Codes

None.

## Dependencies

| Kind | Item |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md` |
| Modules | conversation-standards, discovery-record (via the coordinator), ticket-drafting (consumes decisions and assumptions) |
| Host capabilities | Chat only |

## Configuration

None.

## Testing Entry Points

| Kind | Entry point |
|---|---|
| Eval scenarios (`s1.yml`) | `ac-29` (`default-labelled-as-assumption`, `one-question-at-a-time`) |
| Unit | `tests/scripts/test_record.py`: `AssumptionsTest::test_assumptions_block_stored`, `GoBackTest::test_unrelated_decision_survives_a_goal_change` |
| Unit | `tests/scripts/test_check_record.py::ResumeSignalTest` (step 4 needs decisions and outcome) |
| Authoring | `tests/scripts/test_authoring.py::TriggerHygieneTest` (AC-19) |
