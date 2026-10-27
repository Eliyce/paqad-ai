# Python Skills Plugin Tool Guides

Tool guides for this repository: Markdown skills plus Python 3.9+ standard library scripts, built by `build/build.py`.

| Guide | Use it for |
|---|---|
| [testing.md](testing.md) | Running the unittest suite, one file, or one test |
| [coverage.md](coverage.md) | Measuring branch coverage and holding the 95% bar |
| [build.md](build.md) | Building `dist/` and proving the build is deterministic |
| [validate.md](validate.md) | Running the official skill and plugin validators on `dist/` |
| [evals.md](evals.md) | Authoring and running eval scenarios |
| [hosts.md](hosts.md) | Recording per-host install and verification state |

## Stack pack

The stack is described by the project pack at `.paqad/packs/python-skills-plugin/`. Its rules live in `docs/instructions/rules/coding/stacks/python-skills-plugin/`.

## Do not run

`paqad-ai refresh --rules --force` regenerates `docs/instructions/rules/` from the built-in packs. It deletes the rules above and reinstalls the Laravel pack. `paqad-ai refresh --stack` rewrites `docs/instructions/stack/` with a generated stub. Run neither on this repository.

## Rule check script

A single standard library script that enforces every deterministic rule in the stack pack is planned. Until it exists, `tests/scripts/test_authoring.py` and the build tests enforce the subset they cover.
