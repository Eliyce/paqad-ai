# Project Grounding

Chooses which project to read and detects its evidence level (from project docs, from docs and code, or from code only), reads what is there with code as the baseline for what exists, finds the areas related to an idea or question, and tells real content apart from unfilled template text. No repository with readable code is turned away; the only stop is nothing readable at all.

| | |
|---|---|
| Layer | shared-foundation |
| Confidence | medium |
| Entry skill | none (shared) |
| Depends on | none |
| Used by | [product-questions](../../product-questions/index/summary.md), [idea-journey](../../idea-journey/index/summary.md), [ticket-refinement](../../ticket-refinement/index/summary.md), [work-sizing](../../work-sizing/index/summary.md) |

## Features

| Feature | What it does | Docs |
|---|---|---|
| Get the project documents | Chooses the repository (attached, the only reachable one, or one short list marked by evidence level), runs the GRD-1 readiness check read as the three evidence levels (from project docs, from docs and code, from code only) and remembers the choice and level | [business](../features/get-the-documents/business.md), [technical](../features/get-the-documents/technical.md), [api](../features/get-the-documents/api.md) |
| Find related areas | Ranks the modules in the project's registry, or its area folders and summaries when the registry is missing, against free text, fixes the order in which project documents are read, and sets what the documents prove: an area they do not cover is not documented, never not built, and its code is checked automatically when reachable | [business](../features/find-related-areas/business.md), [technical](../features/find-related-areas/technical.md) |
| Spot unfilled template text | Marks each section of a document as real or template so blank template text is never presented as fact | [business](../features/detect-template-text/business.md), [technical](../features/detect-template-text/technical.md) |

## Sources

| Path | Role |
|---|---|
| `shared/references/connect-repository.md` | The one repository rule: choosing, reaching and remembering the repository, the GRD-1 check mapped to the three evidence levels, never-read list (GRD-1, GRD-3, GRD-12) |
| `shared/references/evidence-levels.md` | The single source for generic mode: the three evidence levels and their detection, the one source line per level, the informational upgrade nudge and the code-only area finder (GRD-12 to GRD-16), copied into skills as `references/evidence-levels.md` |
| `shared/scripts/check_onboarded.py` | The one readiness check and area-summary reader (GRD-1), read as the three evidence levels (GRD-12) |
| `shared/scripts/find_related.py` | Deterministic ranking of registry modules, or area folders and summaries, against a query |
| `shared/references/paqad-docs-map.md` | Reading order (code as the baseline), readiness check and what the documents prove (GRD-8 to GRD-11), copied into skills as `references/paqad-docs-map.md` |
| `shared/scripts/detect_placeholder.py` | Per-section real or template classification |
| `shared/references/template-markers.md` | Marker phrases from both paqad template generations |
| `tests/scripts/test_onboarded.py` | Unit tests for the three-state check |
| `tests/scripts/test_find_related.py` | Unit tests for the ranking, from the registry and from the modules folder |
| `tests/scripts/test_placeholder.py` | Unit tests for template detection, using the real markers file and a real fixture document |
| `tests/scripts/test_evidence_rules.py` | Unit tests for what the documents prove: the shared section, the five declaring skills and their shared checklist line, the build copies, the templates, the REQUIREMENTS text, the fixture shape and the `evidence-rules.yml` header (17 tests) |
| `tests/scripts/test_generic_mode.py` | Unit tests for generic mode: the `evidence-levels.md` reference, its six declarers, the `setup.evidence_level` record field, the source line wordings and the code-only fixture (25 tests) |
| `tests/evals/fixture-repo/docs/` | Fictional paqad-documented repository the tests and scenarios read at the project-docs level (owned by quality-and-release) |
| `tests/evals/fixture-repo-code-only/` | Fictional repository with real code and no paqad docs, read at the code-only level (owned by quality-and-release) |

The ranking and template files ship only into `ask-project` and `ground-in-project`. The reading-order file ships into those two plus `shape-idea`, `refine-ticket` and `size-work`, the skills that build answers, playbacks, findings or size drivers on the documents. `evidence-levels.md` ships into those five plus `get-connected`, the six skills that read a repository at a level. `check_onboarded.py` ships into `ask-project`, `ground-in-project` and `get-connected`; `connect-repository.md` ships into those three plus `refine-ticket` and `size-work`. All as declared in `build/skills.yml`.

## Requirements

- GRD-1: readiness check (ready, partly ready, not set up), owned here in `check_onboarded.py` and `connect-repository.md`, restated in the docs map; it runs in `get-connected`, `ask-project` and `ground-in-project` and is read as the three evidence levels.
- GRD-12 to GRD-16: the three evidence levels (`project-docs`, `docs-and-code`, `code-only`) and their detection, the one source line per level, the informational upgrade nudge and the code-only area finder, owned here in `evidence-levels.md` and consumed by six skills; a level is never a reason to refuse and the only stop is nothing readable at all.
- GRD-3: getting the documents and choosing the repository, by capability (`connect-repository.md`).
- GRD-2: reading order with code as the baseline for what exists; read only what is needed; never read runtime state, rules, secrets or environment files. Row 7, the code, is automatic for an area the documents do not cover when the code is reachable, and is the whole what-exists answer in code-only mode.
- GRD-4: section-level template detection across both template generations; never present template text as fact.
- GRD-5: every fact carries its source path (stated in the docs map).
- GRD-8 to GRD-11: what the documents prove (stated in the docs map). Not documented never states or implies not built, in any wording; a status needs evidence about the exact thing it names (a coming soon tag on a menu entry or screen is that entry's status only), is said as what the docs say and is never carried to another area or the product; a requirements document outside `docs/modules` is intent, never today, while business notes under `docs/modules` are always current behaviour; an area the documents do not cover has its code checked automatically when reachable, at most 5 files, never `.git/` or dependency or vendored folders, and at most one line per area labelled "the code suggests".
- PLG-5: Python 3.9+, standard library only, no network, read-only.
- PLG-9: held once under `shared/` and copied into each declaring skill.
- AC-5, AC-22: template sections flagged and nothing invented (conversation scenarios).
