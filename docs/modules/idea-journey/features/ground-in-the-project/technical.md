# Find what exists today: technical

## Module Boundaries

| Path | Owned |
|---|---|
| `skills/ground-in-project/SKILL.md` | Yes: step 2 procedure and checklist fallback (the folder holds only this file) |
| `shared/scripts/find_related.py`, `shared/scripts/detect_placeholder.py` | No: owned by project-grounding |
| `shared/references/paqad-docs-map.md`, `shared/references/template-markers.md` | No: owned by project-grounding |

Step skill (PLG-8) and script-bearing through its declared shared scripts (`SCRIPT_BEARING_SKILLS` in `test_authoring.py`).

## Data Contracts

Produces the `today` block (written by `product-discovery` through `record.py update`):

```json
[ { "area": "", "source_path": "", "section_status": { "roles": "real", "rules": "template" } } ]
```

`section_status` values are `real` or `template`, taken from `detect_placeholder.py`.

## Script Interfaces

| Script | Call used | stdout | Exit |
|---|---|---|---|
| `scripts/find_related.py` | `--registry <modules.md> --query "<the idea>"` | JSON list `[{"module", "plain_name", "score", "matched_terms"}]`, sorted by descending score, ties by registry order | 0; 1 with `{"ok": false, "error"}` on stderr if the registry is unreadable |
| `scripts/detect_placeholder.py` | `--path <doc.md>` (optional `--markers`) | `{"sections": [{"heading", "status", "markers_hit"}]}` | 0 |

## State Management

`today` is the step 2 required block (`record.REQUIRED[2]`). Changing `today` stales `playback`, `decisions`, `ticket_set_ref`, `readiness`, `posted`. A goal change (`idea`) stales `today`, so this step is redone on going back.

## Error Codes

None. Neither script emits issue codes.

## Dependencies

| Kind | Item |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md`, `references/paqad-docs-map.md`, `references/template-markers.md`, `scripts/find_related.py`, `scripts/detect_placeholder.py` |
| Modules | project-grounding, conversation-standards, discovery-record (via the coordinator) |
| Host capabilities | Reading repository files or user-attached `docs/`; Python 3.9 (optional) |

## Configuration

| Item | Where |
|---|---|
| Template marker phrases (both paqad template generations) | `references/template-markers.md` |
| Reading order and never-read list | `references/paqad-docs-map.md` |

## Testing Entry Points

| Kind | Entry point |
|---|---|
| Unit | `tests/scripts/test_find_related.py` (`ParseTest`, `RankTest`, `CliTest`) |
| Unit | `tests/scripts/test_placeholder.py` (`FixtureDocTest::test_reports_both_real_and_template_sections` and others) |
| Authoring | `tests/scripts/test_authoring.py::FixtureRepoTest` (AC-10), `ChecklistFallbackTest` (AC-16) |
| Eval scenarios (`s1.yml`) | `ac-5` (`template-section-flagged`, `nothing-invented`, `source-every-fact`) |
| Fixture | `tests/evals/fixture-repo/docs/modules/subscriptions/features/manage-subscription/business.md` |
