# Project Grounding

Chooses which project to read and checks how far it is set up, reads its documents in a fixed order, finds the areas related to an idea or question, and tells real content apart from unfilled template text.

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
| Get the project documents | Chooses the repository (attached, the only reachable one, or one short marked list), runs the three-state onboarded check (ready, partly ready, not set up) and remembers the choice | [business](../features/get-the-documents/business.md), [technical](../features/get-the-documents/technical.md), [api](../features/get-the-documents/api.md) |
| Find related areas | Ranks the modules in the project's registry, or its area folders and summaries when the registry is missing, against free text and fixes the order in which project documents are read | [business](../features/find-related-areas/business.md), [technical](../features/find-related-areas/technical.md) |
| Spot unfilled template text | Marks each section of a document as real or template so blank template text is never presented as fact | [business](../features/detect-template-text/business.md), [technical](../features/detect-template-text/technical.md) |

## Sources

| Path | Role |
|---|---|
| `shared/references/connect-repository.md` | The one repository rule: choosing, reaching and remembering the repository, the three-state check, never-read list (GRD-1, GRD-3) |
| `shared/scripts/check_onboarded.py` | The one onboarded check and area-summary reader (GRD-1) |
| `shared/scripts/find_related.py` | Deterministic ranking of registry modules, or area folders and summaries, against a query |
| `shared/references/paqad-docs-map.md` | Reading order and onboarded check, copied into skills as `references/paqad-docs-map.md` |
| `shared/scripts/detect_placeholder.py` | Per-section real or template classification |
| `shared/references/template-markers.md` | Marker phrases from both paqad template generations |
| `tests/scripts/test_onboarded.py` | Unit tests for the three-state check |
| `tests/scripts/test_find_related.py` | Unit tests for the ranking, from the registry and from the modules folder |
| `tests/scripts/test_placeholder.py` | Unit tests for template detection, using the real markers file and a real fixture document |
| `tests/evals/fixture-repo/docs/` | Fictional onboarded repository the tests and scenarios read (owned by quality-and-release) |

The ranking, reading-order and template files ship only into `ask-project` and `ground-in-project`. `check_onboarded.py` ships into those two and `get-connected`; `connect-repository.md` ships into those three plus `refine-ticket` and `size-work`. All as declared in `build/skills.yml`.

## Requirements

- GRD-1: three-state onboarded check (ready, partly ready, not set up), owned here in `check_onboarded.py` and `connect-repository.md`, restated in the docs map; it runs in `get-connected`, `ask-project` and `ground-in-project`.
- GRD-3: getting the documents and choosing the repository, by capability (`connect-repository.md`).
- GRD-2: reading order; read only what is needed; never read runtime state, rules, secrets or environment files.
- GRD-4: section-level template detection across both template generations; never present template text as fact.
- GRD-5: every fact carries its source path (stated in the docs map).
- PLG-5: Python 3.9+, standard library only, no network, read-only.
- PLG-9: held once under `shared/` and copied into each declaring skill.
- AC-5, AC-22: template sections flagged and nothing invented (conversation scenarios).
