# Spot unfilled template text: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `shared/scripts/detect_placeholder.py` | `load_markers`, `split_sections`, `classify`, `main` |
| `shared/references/template-markers.md` | Marker phrases: 7 from the current generation (module-scaffold `business.md`), 3 from the earlier generation |

Not owned here: `skills/size-work/scripts/compare_sizes.py` keeps its own, different template heuristic (`TEMPLATE_MARKERS` such as `todo`, `tbd`, `lorem ipsum`) and does not use this file.

## Data Contracts

Markers file: every non-empty line that does not start with `#` is one marker; a leading `- ` is stripped. Matching is a case-sensitive substring test.

Sections: split on Markdown headings `^#{1,6}\s+`. Content before the first heading becomes a section with an empty heading. Each marker is tested against `heading + "\n" + body`.

Output (stdout):

```json
{"sections": [{"heading": "Business rules", "status": "real", "markers_hit": []},
              {"heading": "Capture the main user journeys for", "status": "template", "markers_hit": ["Capture the main user journeys for"]}]}
```

`status` is `template` when any marker hits, otherwise `real`.

## Script Interfaces

`detect_placeholder.py --path <doc.md> [--markers <template-markers.md>]`

| Arg | Required | Meaning |
|---|---|---|
| `--path` | yes | Document to classify |
| `--markers` | no | Markers file; defaults to `../references/template-markers.md` relative to the script, which is where the build places it inside a skill |

| Exit | When |
|---|---|
| 0 | Classification printed |
| non-zero | Unhandled exception (for example a missing document or markers file raises `FileNotFoundError` with a traceback; there is no structured error path) |

Read-only; writes nothing.

## State Management

None: stateless.

## Error Codes

None.

## Dependencies

| Kind | Detail |
|---|---|
| Python | Standard library only: `argparse`, `json`, `re`, `sys`, `pathlib` |
| Shared imports | None |
| Declared by skills (`build/skills.yml`) | `ask-project`, `ground-in-project` import `scripts/detect_placeholder.py` and `references/template-markers.md`; both must be declared together for the default markers path to resolve |
| Host capability | A tool that runs scripts; otherwise the skills' checklist compares each section with `references/template-markers.md` by hand (PLG-6) |

## Configuration

`shared/references/template-markers.md` is the configuration. The loader reads every non-heading line, so the two explanatory paragraphs at the top of that file are also loaded as markers (five extra entries, including the one-word line `loader.`). Adding a marker means adding one line under a heading.

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_placeholder.py` | `RealMarkersTest.test_markers_file_loads`, `FixtureDocTest.test_reports_both_real_and_template_sections`, `FixtureDocTest.test_template_sections_report_the_markers_they_hit`, `FixtureDocTest.test_real_sections_hit_no_markers`, `SplitTest.test_sections_split_on_headings`, `SplitTest.test_cli_emits_sections` |
| `tests/scripts/test_authoring.py` | `FixtureRepoTest.test_business_md_has_real_and_template_sections` (keeps its own copy of the ten markers) |

Fixture: `tests/evals/fixture-repo/docs/modules/returns/features/request-return/business.md`. Eval scenarios: `s1.yml` `ac-5`, `ac-22` (property `template-section-flagged`).
