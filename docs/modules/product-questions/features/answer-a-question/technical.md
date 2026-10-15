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

Overview answer (ASK-9): a question about what the product or project is, what it does or what areas it has, or what an attached repository is, gets a two-column table (the area's plain name, one line on what it does) and one Sources line. Ready: one row per modules-list row, the line from that row, an area summary read only when the row does not say what the area is for. When that summary is missing too, the line says the area is not documented. Partly ready: one row per summarised area from its summary, plus one row per area without a summary saying it is not documented. Either way a not documented row adds, when the code is reachable, what the code suggests from names only: no file is opened for an overview row (GRD-11). A requirements or specification document outside `docs/modules` is never the source of a row (GRD-10). A coming soon tag on a menu entry in one area's notes is that entry's status only and is never carried to another row or to the product (GRD-9).

Evidence contract (ASK-8, "What the documents prove" in `references/paqad-docs-map.md`, GRD-8 to GRD-11): an area the question needs that has no summary, only template text or no document is "not documented", and nothing states or implies, in any wording, that it is not built (the GRD-8 phrases are examples, not a complete list). When the code is reachable (a tool reads repository files, or the code is attached), the skill checks that area's code automatically: names first, at most 5 files, read only, the never-read list still applies (including `.git/` and dependency or vendored folders such as `vendor/` and `node_modules/`). At most one line per area, labelled "the code suggests", with no code, code names or file contents in the body; the code folders go only on the Sources line. A document's status line is reported as what the docs say, for the exact thing it names only (a coming soon menu entry is that entry's status, not the feature's), never carried to another area or the product, and a docs and code disagreement names both. Business notes under `docs/modules` are always current behaviour, even when they state rules that must hold; only a requirements or specification document outside `docs/modules` is intent (GRD-10). With the code not reachable, at most one short offer line. `answer-template.md` carries the example "Loyalty points are not documented. The code suggests members can earn and redeem points." under its gaps heading (GRD-4, GRD-8, GRD-11). This replaces the earlier optional wording: ASK-8 is now a MUST.

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
| Host capabilities | Reading repository files on demand, or the user attaching `docs/` (with only `docs/` attached the code is not reachable and the GRD-11 check becomes one offer line); optionally a tool that lists the repositories the user can reach (U-18); running Python 3.9 scripts (optional, checklist fallback otherwise). No tracker connector. |

## Configuration

| Item | Where |
|---|---|
| Template marker phrases | `references/template-markers.md` (default `--markers` for `detect_placeholder.py`) |
| Reading order, never-read list and what the documents prove (GRD-8 to GRD-11) | `references/paqad-docs-map.md` |
| Choosing and reaching the repository | `references/connect-repository.md` |
| Trigger | The frontmatter `description` (overview cues, an attached or connected repository, how-it-works-today questions). It raises but cannot guarantee automatic selection by the host; naming the skill always works (PLG-8) |

## Testing Entry Points

| Kind | Entry point |
|---|---|
| Unit | `tests/scripts/test_find_related.py` (`ParseTest`, `RankTest`, `CliTest`, `ModulesDirRowsTest`, `ModulesDirCliTest`) |
| Unit | `tests/scripts/test_onboarded.py` (three-state check) |
| Unit | `tests/scripts/test_placeholder.py` (`RealMarkersTest`, `FixtureDocTest`, `SplitTest`) |
| Authoring | `tests/scripts/test_authoring.py`: `SkillFrontmatterTest`, `VoiceBlockTest` (AC-13), `NeutralWordingTest` (AC-11), `HousePromptTest` (AC-12), `TriggerHygieneTest` (AC-19), `ChecklistFallbackTest` (AC-16), `AskProjectTriggerTest` (the frozen description), `SingleSourceDocAccessTest`, `ThreeStateChecklistTest` |
| Unit | `tests/scripts/test_evidence_rules.py` (`SkillPointerTest`: ask-project declares and points to the section, its checklist bullet is the one shared text, "may look", "material gap", "Only if it is attached" and "never not built" are gone; `ConnectRepositoryTest`: step 1 names areas without a summary as not documented; `TemplateTest`: the answer template's gaps heading and example) |
| Build | `tests/scripts/test_build.py::BuildOutputTest::test_voice_copied_into_each_skill` |
| Eval scenarios (`tests/evals/scenarios/s1.yml`, not run in CI until S3) | `ac-6`, `ac-17`, `ac-21`, `ac-22`, `ac-42`, `ac-43`, `ac-44`, `ac-45`, `ac-46` |
| Eval scenarios (`tests/evals/scenarios/repo-selection.yml`) | Overview answer, repository choice, partly ready (R13-49 to R13-55) |
| Eval scenarios (`tests/evals/scenarios/evidence-rules.yml`) | `ac-57`, `ac-57b`, `ac-58`, `ac-59`, `ac-59b`, `ac-60`, `ac-60b`, `ac-60c`: not documented area, overview row, docs folder only, stale menu-entry status line, a second undocumented area with no status of its own, requirements document as intent, a business-note rule worded as must read as current |
| Fixture | `tests/evals/fixture-repo/` (modules list with seven areas; loyalty and referrals are listed and have invented code under `app/Loyalty/` and `app/Referrals/` but no notes; the members summary has a stale "soon" tag on the account page's loyalty points entry; the `manage-account` business note states a rule worded as must; a vendored `vendor/points-kit` stub the code check never reads; a neutral `Requirements.md` at the root) |
