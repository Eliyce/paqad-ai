# Find related areas: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `shared/scripts/find_related.py` | `tokens`, `parse_registry`, `term_matches`, `rank`, `plain_name_from`, `rows_from_modules_dir`, `load_rows`, `main` |
| `shared/references/paqad-docs-map.md` | GRD-2 reading order table (code is the baseline for what exists; order 1 notes the docs-and-code map from folder names and summaries; order 7, source code, is automatic for an area the documents do not cover when the code is reachable, names first then at most 5 files, reported as what the code suggests), its restatement of the GRD-1 rule mapped to the evidence levels, GRD-5 sources rule, and the `## What the documents prove` section (GRD-8 to GRD-11, scoped to when paqad docs are present) |
| `shared/references/evidence-levels.md` | The single source for generic mode (GRD-12 to GRD-16): the three evidence levels (`project-docs`, `docs-and-code`, `code-only`) and their detection, the one source line per level, the informational upgrade nudge rules, and the code-only area finder (names first, about 15 files per answer, narrow a very large repository). The nudge is worded as information, never an offer to buy or install: in code-only mode it says setting up paqad project docs would give fuller answers and where to read more; in docs-and-code mode it names the areas that lack project docs and offers to help finish their setup. Its one link is exactly `https://paqad.ai/?src=discovery-plugin` (static campaign tag only, never another or a built link), disclosed in the README and privacy policy |

Not owned here: the readiness check and the area-summary reader (`shared/scripts/check_onboarded.py`, get-the-documents, which `find_related.py` imports), the repository rule (`shared/references/connect-repository.md`, get-the-documents) and the reading behaviour itself (the `ask-project` and `ground-in-project` skills, and the `shape-idea`, `refine-ticket` and `size-work` skills that apply what the documents prove and the evidence levels).

`## What the documents prove` holds four rules that every answer, playback, finding and size driver built on the documents follows:

| Rule | Contract |
|---|---|
| GRD-8 | A missing summary, missing document or template section is never evidence that a feature is missing; the area is "not documented". On that evidence nothing may state or imply that the feature is missing, in any wording. The phrasings listed in double quotes ("not built", "unbuilt", "none yet", "none of ... yet", "not implemented", "doesn't exist", "not there") are examples, not a complete list |
| GRD-9 | Built, not built, coming soon or placeholder only from evidence about the exact area or item it names; a document's status line applies only to the exact thing it names (a menu entry or screen tagged coming soon says that entry is not ready yet, not that the feature behind it is unbuilt), is reported as what the docs say, and is never carried over to another area, to the feature behind a menu entry or to the whole product; no area's status is reasoned from another area's documents or screens; when the code is reachable and the status matters, that area's code is checked (GRD-11); a docs and code disagreement is said as "The docs say ..., but the code suggests ..." with neither picked as fact |
| GRD-10 | A requirements or specification document outside `docs/modules` (named as requirements or a specification) is not in the reading order and is never a source for current behaviour or for built or not built; when already in hand or when the user asks about plans, it is quoted only as intended ("The requirements say it is intended to ..."). Business notes under `docs/modules` are always read as current behaviour, even when they state rules that must hold |
| GRD-11 | For an area the answer needs with no summary, only template text or no document, its code is checked automatically when reachable (a tool can read repository files, or the code is attached): that area only, names first, at most 5 files, no file for an overview row, the never-read list still applies (secrets, environment files, `.paqad/`, `docs/instructions/rules/`, `.git/`, and dependency or vendored folders such as `vendor/` and `node_modules/`), read only. At most one "the code suggests ..." line per area, with no code, code names or file contents in the body and the folders on the one Sources line; nothing found under the area's names is still not documented, never not built; with no reachable code, at most one short offer to check it; a code line keeps its label wherever it goes |

No script enforces these rules at answer time; `tests/scripts/test_evidence_rules.py` (quality-and-release) checks that the section, its phrases and its declarers stay in place.

## Data Contracts

Input registry: a Markdown file (target project's `docs/instructions/registries/modules.md`). Every line starting with `|` that splits into at least four cells is a row. Cells are read by position:

| Cell | Read as |
|---|---|
| 0 | `module` (rows where it is empty, equals `module` case-insensitively, or is only `-`, `:` and spaces are skipped) |
| 1 | `plain_name` |
| 2 | `layer` |
| 3 | `features` |

Terms: lowercase alphanumeric tokens of length 3 or more (`MIN_TERM = 3`) from all four cells.

Input modules folder (`--modules-dir`, used at the docs-and-code level, no modules list): `rows_from_modules_dir` calls `check_onboarded.area_summaries` (it never reads the folders itself) and returns one row per area with a non-empty summary, in sorted area order, in the same row shape `parse_registry` returns:

| Field | Value |
|---|---|
| `module` | The area folder name |
| `plain_name` | The first summary line that starts with `# `, prefix removed and stripped; the folder name when there is none |
| `layer`, `features` | Empty strings |
| `terms` | Tokens of the folder name joined with tokens of the summary text |

Areas without a summary are skipped here; `check_onboarded.py` reports them as unknown.

Output (stdout), a JSON list in rank order:

```json
[{"module": "returns", "plain_name": "Returns and refunds", "score": 2, "matched_terms": ["refund", "return"]}]
```

`score` is the count of distinct query terms that match any module term, where a match is equality or a substring either way. Only rows with `score > 0` are returned. Sort is by descending score, ties by row order: registry order for `--registry`, sorted area order for `--modules-dir`. The same tree and query give byte-identical output, independent of filesystem listing order.

## Script Interfaces

`find_related.py (--registry <modules.md> | --modules-dir <docs/modules>) --query "<idea or question>"`

| Arg | Required | Meaning |
|---|---|---|
| `--registry` | one of the two | Path to the registry Markdown (project-docs level) |
| `--modules-dir` | one of the two | Path to the `docs/modules` folder (docs-and-code level) |
| `--query` | yes | Free text to rank against |

`--registry` and `--modules-dir` are a required mutually exclusive pair.

| Exit | When | Output |
|---|---|---|
| 0 | Source read and at least one row (for `--modules-dir`) | JSON list on stdout; `[]` means nothing matched the query |
| 1 | Registry missing or unreadable (`OSError`) | `{"ok": false, "error": "<message>"}` on stderr, nothing on stdout |
| 1 | Modules folder missing or not a folder | `{"ok": false, "error": "modules folder not found: <path>"}` on stderr, nothing on stdout |
| 1 | Modules folder with no area that has a non-empty summary | `{"ok": false, "error": "no module summaries were found in <path>"}` on stderr, nothing on stdout (never an empty list that looks valid) |
| 2 | Both or neither of `--registry` and `--modules-dir`, or no `--query` | `argparse` usage error on stderr |

Read-only; writes nothing.

## State Management

None: stateless.

## Error Codes

None. The failures are the exit 1 paths above (the raw `OSError` text, or one of the two fixed messages) and the exit 2 usage error.

## Dependencies

| Kind | Detail |
|---|---|
| Python | Standard library only: `argparse`, `json`, `re`, `sys`, `pathlib` |
| Shared imports | `check_onboarded` (sibling script, for `area_summaries`); not `canonical.py` |
| Declared by skills (`build/skills.yml`) | `ask-project`, `ground-in-project` import `scripts/find_related.py` and `references/paqad-docs-map.md`; `shape-idea`, `refine-ticket` and `size-work` import `references/paqad-docs-map.md` only. `references/evidence-levels.md` is imported by those five plus `get-connected` (six declarers, GRD-12). Every skill that declares `scripts/find_related.py` must also declare `scripts/check_onboarded.py`, or the import fails in `dist/` |
| Host capability | A tool that runs scripts; otherwise the skills' "If the checks cannot run" checklist picks candidates by hand (PLG-6). A tool that reads repository files, or the user attaching `docs/` (GRD-3). The GRD-11 code check needs the code to be reachable: a tool that reads repository files, or the code attached; only `docs/` attached means it is not |

## Configuration

None. Module constants: `MIN_TERM = 3`, `HEADING_PREFIX = "# "`, and the two error message formats `NO_SUMMARIES` and `NOT_A_FOLDER`.

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_find_related.py` | Registry path: `ParseTest`, `RankTest` (obvious module, determinism, no match, registry-order ties, output fields), `CliTest` (missing registry exits 1, a written registry). Modules-folder path: `ModulesDirRowsTest` (real fixture rows match the registry row shape, missing and empty summaries skipped, `plain_name` from the first heading or the folder name, a missing folder gives no rows, deterministic ranking with sorted-folder ties), `ModulesDirCliTest` (ranked list on the fixture, no match is `[]` with exit 0, missing folder, a file path and a folder without summaries each exit 1 with stdout empty, both or neither source and a missing query exit 2) |

Eval scenarios that exercise grounding through the entry skills: `s1.yml` `ac-5`, `ac-21`, `ac-22`, `ac-26`, `ac-46`, `repo-selection.yml` `ac-55` (docs-and-code ranking), `evidence-rules.yml` `ac-57` to `ac-61b` (what the documents prove), and `generic-mode.yml` `gm-1`, `gm-56`, `gm-62`, `gm-67` (the code-only finder and the evidence levels) (declarative, not yet run in CI).
