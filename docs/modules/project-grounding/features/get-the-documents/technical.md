# Get the project documents: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `shared/references/connect-repository.md` | The one repository rule (GRD-3): by capability, choosing the repository, remembering the choice, the three-state onboarded check (GRD-1) with both exact sentences and the by-hand version, the never-read list |
| `shared/scripts/check_onboarded.py` | The one onboarded check and the one area-summary reader: `read_stripped`, `area_names`, `area_summaries`, `onboarded_state`, `is_onboarded`, `result_payload`, `main`; constants `STOP_MESSAGE`, `PARTLY_MESSAGE`, `READY`, `PARTLY_READY`, `NOT_SET_UP` |

Not owned here: the reading order and its copy of the onboarded rule (`shared/references/paqad-docs-map.md`, find-related-areas), the ranking (`shared/scripts/find_related.py`, find-related-areas, which imports `check_onboarded.area_summaries` for its `--modules-dir` source), and the skill steps that apply the rule (`get-connected`, `ask-project`, `ground-in-project`, `refine-ticket`, `size-work`).

Both files were skill-local to `get-connected` before; they moved to `shared/` because a second skill needed each (PLG-9, RL-04a1). No skill-local copy remains (INV-4).

## Data Contracts

Inputs read from the target repository (paths relative to `--root`):

| Path | Counts as present when |
|---|---|
| `docs/instructions/registries/modules.md` (the modules list) | A regular file whose UTF-8 text is not empty or whitespace-only |
| `docs/modules/<area>/index/summary.md` (an area summary) | A regular file whose UTF-8 text is not empty or whitespace-only |

An area is an immediate sub-folder of `docs/modules/` whose name does not start with `.`. Plain files under `docs/modules/` are ignored. Any `OSError` or `UnicodeDecodeError` while listing, testing or reading counts as missing, never as a crash (FR-2).

`area_summaries(modules_dir)` returns `[(area, text), ...]` sorted by area name (Python's default string sort), `text` stripped, `""` when the summary is missing or unreadable, and `[]` when `modules_dir` is missing, not a folder or cannot be listed. It is the only summary reader in the source tree.

`onboarded_state(root)` returns `{"state", "summarised_areas", "unknown_areas"}`, both lists in `area_summaries` order:

| State | Condition |
|---|---|
| `ready` | Modules list present and at least one summarised area |
| `partly-ready` | No modules list and at least one summarised area |
| `not-set-up` | No summarised area, whatever else exists (`docs/instructions` alone, a modules list with no summaries, only empty summaries, an empty tree, a root that does not exist) |

`is_onboarded(root)` is true only for `ready`, so its old meaning holds.

The chosen repository is recorded in the discovery record's `setup` block (REC-1): `setup.repository` (the name as the tool or attachment shows it, `""` when none is shown) and `setup.repository_state` (`ready` or `partly-ready`). Written by `get-connected` at step 0, or by the first docs-reading step of a refine or size run, through `record.py update`. `setup` is outside the go-back chain, so both survive going back; neither holds credentials (REC-6). Outside a run nothing is stored; the choice lives for the rest of the conversation.

## Script Interfaces

`check_onboarded.py [--root <repo-root>]`; full contract in [api.md](api.md). Exit 0 for ready and partly ready, 1 for not set up, 2 for a usage error. Read-only; writes nothing; no network.

The choosing rule is instructions only (`connect-repository.md`); no script lists repositories. Marks for the choice list come from the quick form of the check on the repositories shown, done with whatever read capability the host has; a repository that cannot be read is `not checked`, never `ready` (INV-3).

## State Management

The script is stateless. The repository choice is state only inside a run (`setup.repository`, `setup.repository_state`); a switch the user asks for patches `setup` through `record.py update` and redoes step 2 onward as a go-back. A resumed run reuses the recorded repository and, when it can no longer be read, asks to attach that same repository.

## Error Codes

None. The script reports only `ok`, `state`, the fixed message and `unknown_areas`. An unknown argument is an `argparse` usage error (exit 2, usage on stderr).

## Failure Paths

| Situation | Behaviour |
|---|---|
| Unreadable or undecodable summary | Area is unknown; state follows the remaining areas |
| Unlistable `docs/modules` | No areas, so not set up (exit 1) |
| Every reachable repository not set up | STOP_MESSAGE alone, no choice list |
| Chosen repository not set up | STOP_MESSAGE, then one line offering repositories marked ready or partly ready |
| No listing tool, or it lists none | Ask to attach the repository or `docs/`, or upload `docs/` (U-5 smallest set) |
| Host lists but cannot read | Every repository marked not checked; the chosen one is read through the attach request |
| Scripts cannot run | Each skill's "If the checks cannot run" checklist does the three-state check by hand (PLG-6) |

## Dependencies

| Kind | Detail |
|---|---|
| Python | Standard library only: `argparse`, `json`, `sys`, `pathlib`; Python 3.9+ (PLG-5) |
| Shared imports | None (does not import `canonical.py`, to keep three skills free of an extra declared import) |
| Declared by skills (`build/skills.yml`) | `references/connect-repository.md`: `ask-project`, `get-connected`, `ground-in-project`, `refine-ticket`, `size-work`. `scripts/check_onboarded.py`: `get-connected`, `ask-project`, `ground-in-project` (every skill that declares `scripts/find_related.py` also declares it, because `find_related.py` imports it). `plan-sprint` declares neither |
| Host capability | Reading repository files on demand, or the user attaching or uploading `docs/`; optionally a tool that lists reachable repositories with an activity time (unverified per host, U-18); running Python scripts (optional) |

## Configuration

None. Paths, state names and both sentences are module constants in `check_onboarded.py`. The sentences are quoted byte for byte in `connect-repository.md`, `paqad-docs-map.md` and REQUIREMENTS.md GRD-1; the authoring tests import the constants rather than retyping them.

## Trigger note

The wider `ask-project` description (overview questions, an attached or connected repository) raises the chance that a host loads the skill on its own for a matching message, but cannot guarantee it, because the host decides. Naming the skill always works (PLG-8).

## Testing Entry Points

| File | What it covers |
|---|---|
| `tests/scripts/test_onboarded.py` | The three states on the real fixture and temp copies of it: ready payload and default root, both constants, partly ready (modules list removed, whitespace-only or a folder), unknown areas (missing, empty, whitespace-only, invalid UTF-8 summaries), not set up (every summary empty, `docs/modules` removed, folders without summaries, `docs/instructions` only, empty tree, missing root), sorted order ignoring hidden entries, the `OSError` paths (unlistable folder, unstattable file, unreadable summary), usage error exit 2 |
| `tests/scripts/test_find_related.py` | `ModulesDirRowsTest`, `ModulesDirCliTest`: the `--modules-dir` source that reads summaries through `area_summaries` |
| `tests/scripts/test_authoring.py` | `RepositorySelectionTest` (shared rule carries the selection cues, four marks and both sentences imported from the script; no skill-local copy), `RepositoryDeclarationTest` (who declares the two files), `SingleSourceDocAccessTest`, `RecordRepositoryFieldsTest`, `ThreeStateChecklistTest` |
| `tests/scripts/test_build.py` | Dist copies of both files in the declaring skills, byte-identical to the source |
| `tests/evals/scenarios/repo-selection.yml` | Conversation scenarios for the repository choice, partly ready and the overview answer (R13-49 to R13-55); R13-56 is script-proven by `test_onboarded.py` |
