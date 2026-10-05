# Project Grounding

Reads an onboarded project's documents in a fixed order, finds the areas related to an idea or question, and tells real content apart from unfilled template text.

| | |
|---|---|
| Layer | shared-foundation |
| Confidence | medium |
| Entry skill | none (shared) |
| Depends on | none |
| Used by | [product-questions](../../product-questions/index/summary.md), [idea-journey](../../idea-journey/index/summary.md) |

## Features

| Feature | What it does | Docs |
|---|---|---|
| Find related areas | Ranks the modules in the project's registry against free text and fixes the order in which project documents are read | [business](../features/find-related-areas/business.md), [technical](../features/find-related-areas/technical.md) |
| Spot unfilled template text | Marks each section of a document as real or template so blank template text is never presented as fact | [business](../features/detect-template-text/business.md), [technical](../features/detect-template-text/technical.md) |

## Sources

| Path | Role |
|---|---|
| `shared/scripts/find_related.py` | Deterministic ranking of registry modules against a query |
| `shared/references/paqad-docs-map.md` | Reading order and onboarded check, copied into skills as `references/paqad-docs-map.md` |
| `shared/scripts/detect_placeholder.py` | Per-section real or template classification |
| `shared/references/template-markers.md` | Marker phrases from both paqad template generations |
| `tests/scripts/test_find_related.py` | Unit tests for the ranking |
| `tests/scripts/test_placeholder.py` | Unit tests for template detection, using the real markers file and a real fixture document |
| `tests/evals/fixture-repo/docs/` | Fictional onboarded repository the tests and scenarios read (owned by quality-and-release) |

All four source files ship only into `ask-project` and `ground-in-project`, as declared in `build/skills.yml`.

## Requirements

- GRD-1: onboarded check (stated in the docs map; the check itself runs in `get-connected` and `ask-project`).
- GRD-2: reading order; read only what is needed; never read runtime state, rules, secrets or environment files.
- GRD-4: section-level template detection across both template generations; never present template text as fact.
- GRD-5: every fact carries its source path (stated in the docs map).
- PLG-5: Python 3.9+, standard library only, no network, read-only.
- PLG-9: held once under `shared/` and copied into each declaring skill.
- AC-5, AC-22: template sections flagged and nothing invented (conversation scenarios).
