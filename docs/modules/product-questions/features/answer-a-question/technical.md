# Answer a question with sources: technical

## Module Boundaries

| Path | Owned |
|---|---|
| `skills/ask-project/SKILL.md` | Yes: trigger, procedure, checklist fallback |
| `skills/ask-project/references/answer-template.md` | Yes: answer shape |
| `shared/scripts/find_related.py`, `shared/scripts/detect_placeholder.py` | No: owned by project-grounding, copied in at build time |
| `shared/references/paqad-docs-map.md`, `shared/references/template-markers.md` | No: owned by project-grounding |
| `shared/references/voice.md`, `shared/references/consulting.md` | No: owned by conversation-standards |

`ask-project` ships no script of its own. It is an entry skill (PLG-8) and is listed in `ENTRY_SKILLS` in `tests/scripts/test_authoring.py`.

## Data Contracts

No record block is written by this feature. Inputs read from the target project:

| Input | Shape |
|---|---|
| `docs/instructions/registries/modules.md` | Markdown pipe table; `find_related.py` reads columns Module, Plain name, Layer, Features |
| `docs/modules/<module>/index/summary.md`, `.../features/<feature>/business.md` | Markdown split into sections by heading |

Reply contract (from `answer-template.md`): answer first, then exactly one line `Sources: <path>[, <path>...]`. Paths and technical names appear only on that line.

## Script Interfaces

The skill calls two shared scripts (documented in full under project-grounding):

| Script | Call used by this skill | stdout | Exit |
|---|---|---|---|
| `scripts/find_related.py` | `--registry <modules.md> --query "<the question>"` | JSON list of `{"module", "plain_name", "score", "matched_terms"}`, ranked by score then registry order | 0; 1 with `{"ok": false, "error"}` on stderr when the registry is unreadable |
| `scripts/detect_placeholder.py` | `--path <doc.md>` (optional `--markers <file>`) | `{"sections": [{"heading", "status": "real"\|"template", "markers_hit"}]}` | 0 |

The onboarded check (GRD-1) is described in the skill but `ask-project` does not import `check_onboarded.py` (that script belongs to `get-connected`). The skill states the two-path rule inline and does it by reading.

## State Management

Stateless. No discovery record is created, read or written. No revision or digest rules apply.

## Error Codes

None. The shared scripts used here emit no issue codes; `find_related.py` reports only `{"ok": false, "error": <message>}` on an unreadable registry.

## Dependencies

| Kind | Item |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md`, `references/consulting.md`, `references/paqad-docs-map.md`, `references/template-markers.md`, `scripts/find_related.py`, `scripts/detect_placeholder.py` |
| Modules | project-grounding, conversation-standards |
| Host capabilities | Reading repository files on demand, or the user attaching `docs/`; running Python 3.9 scripts (optional, checklist fallback otherwise). No tracker connector. |

## Configuration

| Item | Where |
|---|---|
| Template marker phrases | `references/template-markers.md` (default `--markers` for `detect_placeholder.py`) |
| Reading order and never-read list | `references/paqad-docs-map.md` |

## Testing Entry Points

| Kind | Entry point |
|---|---|
| Unit | `tests/scripts/test_find_related.py` (`ParseTest`, `RankTest`, `CliTest`) |
| Unit | `tests/scripts/test_placeholder.py` (`RealMarkersTest`, `FixtureDocTest`, `SplitTest`) |
| Authoring | `tests/scripts/test_authoring.py`: `SkillFrontmatterTest`, `VoiceBlockTest` (AC-13), `NeutralWordingTest` (AC-11), `HousePromptTest` (AC-12), `TriggerHygieneTest` (AC-19), `ChecklistFallbackTest` (AC-16) |
| Build | `tests/scripts/test_build.py::BuildOutputTest::test_voice_copied_into_each_skill` |
| Eval scenarios (`tests/evals/scenarios/s1.yml`, not run in CI until S3) | `ac-6`, `ac-17`, `ac-21`, `ac-22`, `ac-42`, `ac-43`, `ac-44`, `ac-45`, `ac-46` |
| Fixture | `tests/evals/fixture-repo/` (modules subscriptions, orders, members) |
