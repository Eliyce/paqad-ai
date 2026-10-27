# Find what exists today: technical

## Module Boundaries

| Path | Owned |
|---|---|
| `skills/ground-in-project/SKILL.md` | Yes: step 2 procedure and checklist fallback (the folder holds only this file) |
| `shared/scripts/find_related.py`, `shared/scripts/detect_placeholder.py`, `shared/scripts/check_onboarded.py` | No: owned by project-grounding |
| `shared/references/paqad-docs-map.md`, `shared/references/evidence-levels.md`, `shared/references/template-markers.md`, `shared/references/connect-repository.md` | No: owned by project-grounding |

Step skill (PLG-8) and script-bearing through its declared shared scripts (`SCRIPT_BEARING_SKILLS` in `test_authoring.py`).

## Data Contracts

Produces the `today` block (written by `product-discovery` through `record.py update`):

```json
[
  { "area": "", "source_path": "", "section_status": { "roles": "real", "rules": "template" } },
  { "area": "", "source_path": "", "section_status": { "summary": "missing" }, "code_suggests": "", "code_source_path": "" }
]
```

`section_status` values are `real` or `template`, taken from `detect_placeholder.py`. At the docs-and-code level, each area without a summary whose folder name overlaps the idea is listed with `source_path` `docs/modules/<area>/` and `section_status` `{"summary": "missing"}`. At the code-only level the areas are found from the code by names and every today entry is built from the code with the `code_suggests` field. The today block carries one source line for the evidence level (GRD-14).

What the documents prove ("What the documents prove" in `references/paqad-docs-map.md`, GRD-8 to GRD-11): template and missing points are listed as not documented, and nothing states or implies, in any wording, that the feature is not built. A document's status line is recorded as what the docs say, for the exact thing it names only, and a requirements document outside `docs/modules` is recorded only as intended, while business notes under `docs/modules` are always current behaviour. For a related area the documents do not cover, the skill checks that area's code automatically when the code is reachable (names first, at most 5 files, read only, the never-read list still applies, including `.git/` and dependency or vendored folders such as `vendor/` and `node_modules/`) and records at most one code line per area, in two optional fields on that area's entry:

| Field | Value |
|---|---|
| `code_suggests` | One plain line that itself contains "the code suggests" (GRD-11) |
| `code_source_path` | The code folder the line came from |

`source_path` then names where the area was found: `docs/modules/<area>/` when the folder exists, otherwise the modules list. Both code fields are left out when the code was not checked. No script writes or validates them; the shape is the record template's (`skills/product-discovery/assets/record-template.md`). This replaces the earlier rule that code was read only when attached and the documents left a material gap.

## Script Interfaces

| Script | Call used | stdout | Exit |
|---|---|---|---|
| `scripts/check_onboarded.py` | `[--root <repo-root>]`, run first | `{"ok", "state", ...}`; contract in project-grounding get-the-documents `api.md`. States read as the project-docs, docs-and-code and code-only levels (GRD-12) | 0 ready or partly ready; 1 not set up (code-only, not a stop) |
| `scripts/find_related.py` | Project-docs: `--registry <modules.md> --query "<the idea>"`. Docs-and-code: `--modules-dir docs/modules --query "<the idea>"`. Code-only: the areas are found from the code by names (no script) | JSON list `[{"module", "plain_name", "score", "matched_terms"}]`, sorted by descending score, ties by registry order or sorted folder order | 0; 1 with `{"ok": false, "error"}` on stderr if the registry is unreadable, or the modules folder is missing or holds no summary |
| `scripts/detect_placeholder.py` | `--path <doc.md>` (optional `--markers`) | `{"sections": [{"heading", "status", "markers_hit"}]}` | 0 |

## State Management

`today` is the step 2 required block (`record.REQUIRED[2]`). Changing `today` stales `playback`, `decisions`, `ticket_set_ref`, `readiness`, `posted`. A goal change (`idea`) stales `today`, so this step is redone on going back.

## Error Codes

None. Neither script emits issue codes.

## Dependencies

| Kind | Item |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md`, `references/paqad-docs-map.md`, `references/evidence-levels.md`, `references/template-markers.md`, `references/connect-repository.md`, `scripts/check_onboarded.py`, `scripts/find_related.py`, `scripts/detect_placeholder.py` |
| Modules | project-grounding, conversation-standards, discovery-record (via the coordinator) |
| Host capabilities | Reading repository files or user-attached `docs/` (only `docs/` attached means the code is not reachable, so no code check); Python 3.9 (optional) |

## Configuration

| Item | Where |
|---|---|
| Template marker phrases (both paqad template generations) | `references/template-markers.md` |
| Which repository and how to reach it | `references/connect-repository.md` (the repository chosen at step 0, in `setup.repository`) |
| Reading order (code as the baseline), never-read list and what the documents prove (GRD-8 to GRD-11) | `references/paqad-docs-map.md` |
| The evidence levels, the source line, the nudge and the code-only finder (GRD-12 to GRD-16) | `references/evidence-levels.md` |

## Testing Entry Points

| Kind | Entry point |
|---|---|
| Unit | `tests/scripts/test_find_related.py` (`ParseTest`, `RankTest`, `CliTest`, `ModulesDirRowsTest`, `ModulesDirCliTest`) |
| Unit | `tests/scripts/test_onboarded.py` (three-state check) |
| Unit | `tests/scripts/test_placeholder.py` (`FixtureDocTest::test_reports_both_real_and_template_sections` and others) |
| Authoring | `tests/scripts/test_authoring.py::FixtureRepoTest` (AC-10), `ChecklistFallbackTest` (AC-16), `SingleSourceDocAccessTest`, `ThreeStateChecklistTest` |
| Unit | `tests/scripts/test_evidence_rules.py` (`SkillPointerTest`: declares and points to the section, its checklist bullet is the one shared text, old optional wording gone; `TemplateTest::test_answer_playback_and_record_templates`: the record template's `today` entry with `code_suggests` and `code_source_path`) |
| Eval scenarios (`s1.yml`) | `ac-5` (`template-section-flagged`, `nothing-invented`, `source-every-fact`) |
| Eval scenarios (`evidence-rules.yml`) | `ac-57c` (`today-entry-code-line-labelled`, `code-suggests-labelled`, `no-not-built-claim`) |
| Fixture | `tests/evals/fixture-repo/docs/modules/subscriptions/features/manage-subscription/business.md` |
