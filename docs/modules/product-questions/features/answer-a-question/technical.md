# Answer a question with sources: technical

## Module Boundaries

| Path | Owned |
|---|---|
| `skills/ask-project/SKILL.md` | Yes: trigger, procedure, checklist fallback |
| `skills/ask-project/references/answer-template.md` | Yes: answer shape |
| `shared/scripts/check_onboarded.py`, `shared/scripts/find_related.py`, `shared/scripts/detect_placeholder.py` | No: owned by project-grounding, copied in at build time |
| `shared/references/connect-repository.md`, `shared/references/paqad-docs-map.md`, `shared/references/template-markers.md` | No: owned by project-grounding |
| `shared/references/voice.md`, `shared/references/consulting.md` | No: owned by conversation-standards |

`ask-project` ships no script of its own. It is an entry skill (PLG-8) and is listed in `ENTRY_SKILLS` in `tests/scripts/test_authoring.py`.

## Data Contracts

No record block is written by this feature. Inputs read from the target project:

| Input | Shape |
|---|---|
| `docs/instructions/registries/modules.md` | Markdown pipe table; `find_related.py --registry` reads columns Module, Plain name, Layer, Features. Absent in a partly ready repository |
| `docs/modules/<module>/index/summary.md`, `.../features/<feature>/business.md` | Markdown split into sections by heading; with no registry, `find_related.py --modules-dir` ranks from the folder names and summaries |

Reply contract (from `answer-template.md`): answer first, then exactly one line `Sources: <path>[, <path>...]`. Paths and technical names appear only on that line.

Overview answer (ASK-9): a question about what the product or project is, what it does or what areas it has, or what an attached repository is, gets a two-column table (the area's plain name, one line on what it does) and one Sources line. Ready: one row per modules-list row, the line from that row, an area summary read only when the row does not say what the area is for. Partly ready: one row per summarised area from its summary, plus one row per unknown area saying it is unknown.

The repository is chosen by `references/connect-repository.md` and, outside a run, the choice holds for the rest of the conversation; nothing is stored.

## Script Interfaces

The skill calls three shared scripts (documented in full under project-grounding):

| Script | Call used by this skill | stdout | Exit |
|---|---|---|---|
| `scripts/check_onboarded.py` | `[--root <repo-root>]`, run first (GRD-1) | `{"ok", "state", ...}`: `ready`, `partly-ready` (with `message`) or `not-set-up` (with the stop message); contract in get-the-documents `api.md` | 0 ready or partly ready; 1 not set up |
| `scripts/find_related.py` | Ready: `--registry <modules.md> --query "<the question>"`. Partly ready: `--modules-dir docs/modules --query "<the question>"` | JSON list of `{"module", "plain_name", "score", "matched_terms"}`, ranked by score then registry order or sorted folder order | 0; 1 with `{"ok": false, "error"}` on stderr when the registry is unreadable, or the modules folder is missing or holds no summary |
| `scripts/detect_placeholder.py` | `--path <doc.md>` (optional `--markers <file>`) | `{"sections": [{"heading", "status": "real"\|"template", "markers_hit"}]}` | 0 |

`ask-project` runs `check_onboarded.py` as step 1 and handles its three states; its "If the checks cannot run" checklist does the same three-state check by reading (PLG-6).

## State Management

Stateless. No discovery record is created, read or written. No revision or digest rules apply.

## Error Codes

None. The shared scripts used here emit no issue codes; `find_related.py` reports only `{"ok": false, "error": <message>}` on an unreadable registry or a missing or summary-less modules folder.

## Dependencies

| Kind | Item |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md`, `references/consulting.md`, `references/paqad-docs-map.md`, `references/template-markers.md`, `references/connect-repository.md`, `scripts/check_onboarded.py`, `scripts/find_related.py`, `scripts/detect_placeholder.py` |
| Modules | project-grounding, conversation-standards |
| Host capabilities | Reading repository files on demand, or the user attaching `docs/`; optionally a tool that lists the repositories the user can reach (U-18); running Python 3.9 scripts (optional, checklist fallback otherwise). No tracker connector. |

## Configuration

| Item | Where |
|---|---|
| Template marker phrases | `references/template-markers.md` (default `--markers` for `detect_placeholder.py`) |
| Reading order and never-read list | `references/paqad-docs-map.md` |
| Choosing and reaching the repository | `references/connect-repository.md` |
| Trigger | The frontmatter `description` (overview cues, an attached or connected repository, how-it-works-today questions). It raises but cannot guarantee automatic selection by the host; naming the skill always works (PLG-8) |

## Testing Entry Points

| Kind | Entry point |
|---|---|
| Unit | `tests/scripts/test_find_related.py` (`ParseTest`, `RankTest`, `CliTest`, `ModulesDirRowsTest`, `ModulesDirCliTest`) |
| Unit | `tests/scripts/test_onboarded.py` (three-state check) |
| Unit | `tests/scripts/test_placeholder.py` (`RealMarkersTest`, `FixtureDocTest`, `SplitTest`) |
| Authoring | `tests/scripts/test_authoring.py`: `SkillFrontmatterTest`, `VoiceBlockTest` (AC-13), `NeutralWordingTest` (AC-11), `HousePromptTest` (AC-12), `TriggerHygieneTest` (AC-19), `ChecklistFallbackTest` (AC-16), `AskProjectTriggerTest` (the frozen description), `SingleSourceDocAccessTest`, `ThreeStateChecklistTest` |
| Build | `tests/scripts/test_build.py::BuildOutputTest::test_voice_copied_into_each_skill` |
| Eval scenarios (`tests/evals/scenarios/s1.yml`, not run in CI until S3) | `ac-6`, `ac-17`, `ac-21`, `ac-22`, `ac-42`, `ac-43`, `ac-44`, `ac-45`, `ac-46` |
| Eval scenarios (`tests/evals/scenarios/repo-selection.yml`) | Overview answer, repository choice, partly ready (R13-49 to R13-55) |
| Fixture | `tests/evals/fixture-repo/` (modules subscriptions, orders, members) |
