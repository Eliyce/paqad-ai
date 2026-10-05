# Short, plain replies: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `shared/references/voice.md` | Twelve rules under "The rules", matching TALK-1 to TALK-12 in order (the file does not print the IDs) |

Each `skills/<name>/SKILL.md` carries its own "How to talk" paragraph that points to `references/voice.md`; those paragraphs are owned by the skill's module.

## Data Contracts

None. Plain Markdown instruction text. In `dist/` it sits at `skills/<name>/references/voice.md` in every skill.

## Script Interfaces

None: this feature is instruction-only.

## State Management

None: stateless.

## Error Codes

None.

## Dependencies

| Kind | Detail |
|---|---|
| Declared by skills (`build/skills.yml`) | All 13 skills import `references/voice.md` |
| Build check | `build/build.py` fails if a `SKILL.md` names a shared file it did not declare (PLG-10); every `SKILL.md` names `references/voice.md` |
| Host capability | None |

## Configuration

None.

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_authoring.py` | `VoiceBlockTest.test_each_skill_opens_with_voice_block`: "How to talk" within the first 10 non-empty body lines and `references/voice.md` within the first 15 (TALK-10, CI-20) |
| `tests/scripts/test_build.py` | `BuildOutputTest.test_voice_copied_into_each_skill` |

Eval scenarios (declarative, not yet run in CI): `s1.yml` `ac-3`, `ac-15`, `ac-23`, `ac-48` (`one-line-status`); `ac-42`, `ac-44`, `ac-48` (`no-narration`); `ac-42` (`table-for-list`); `ac-45` (`yes-no-short`); `ac-43`, `ac-46` (`plain-business-words`); `ac-47` (`compact-preview-plus-file`); `ac-6`, `ac-17`, `ac-21`, `ac-24`, `ac-42` to `ac-46` (`single-sources-line`).

The CI-20 step in `.github/workflows/ci.yml` is still a placeholder; the check runs through the unit suite in CI-7.
