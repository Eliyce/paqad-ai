# Create, update and advance the record: technical

## Module Boundaries

Owned paths: `shared/scripts/record.py`, `skills/product-discovery/assets/record-template.md`. `record.py` is copied into `product-discovery`, `refine-ticket`, `size-work` and `plan-sprint` at build time (`build/skills.yml`).

## Data Contracts

`record.new_record(run_id, mode)` returns:

| Key | Initial value | Notes |
|---|---|---|
| `run` | `{run_id, revision: 0, step: 0, updated_at, mode}` | Managed metadata, never patchable |
| `setup`, `idea`, `playback`, `outcome`, `ticket_set_ref`, `readiness`, `changes`, `sizing`, `sprint_plan` | `{}` | |
| `glossary`, `today`, `decisions`, `assumptions`, `existing` | `[]` | |
| `posted` | `{"issues": [], "read_back": {}}` | |
| `stale` | `[]` | Sorted list of stale block names |
| `approval` | `null` | `{block, digest, message_ref}` when bound |

- `BLOCKS` (patchable): setup, idea, glossary, today, playback, decisions, assumptions, outcome, ticket_set_ref, readiness, posted, existing, changes, sizing, sprint_plan.
- Run id: `DR-YYYYMMDD-XXXX`, suffix from `ABCDEFGHJKLMNPQRSTUVWXYZ0123456789`.
- `validate` requires a dict, a `run` dict, non-negative int `revision`, int `step` 0 to 6, every block in `BLOCKS`, and a list `stale`.
- `record-template.md` documents field shapes for the build-mode blocks (for example `setup.size_field_id`, `setup.sprint_field_id`, `ticket_set_ref.{path, digest, revision}`, `posted.issues[].status` of created, uncertain or not applied).
- `setup.repository` (the chosen repository's name as the tool or attachment shows it, `""` when none is shown) and `setup.repository_state` (`ready` or `partly-ready`) are template fields only: `record.py` does not validate them. `get-connected` sets them at step 0, or the first docs-reading step of a refine or size run sets them; a switch the user asks for patches them with `record.py update`. Being in `setup`, they sit outside the chain and survive going back. Neither holds credentials (REC-6).
- `today` entries carry `area`, `source_path` and `section_status` (per section `real` or `template`, or `{"summary": "missing"}` for an area without a summary). An entry for an area the documents do not cover may add `code_suggests` (one plain line that itself contains "the code suggests") and `code_source_path` (the code folder it came from), written by `ground-in-project` when it checked that area's code (GRD-11). `source_path` then names where the area was found: `docs/modules/<area>/` when the folder exists, otherwise the modules list. Both fields are left out when the code was not checked. They are template fields only: `record.py` does not validate them, and `today` stays in the chain, so changing them stales `playback` onward.

## Script Interfaces

`record.py` (standard library, no network, writes only the given `--path`):

| Subcommand | Args | stdout on success |
|---|---|---|
| `init` | `--path`, `--run-id`, `--mode build\|refine\|size\|plan` | `{"revision", "step", "status": "initialized"}` |
| `show` | `--path` | `{"record": {...}, "ticket_digest": <ticket_set_ref.digest>}` |
| `update` | `--path`, `--expect-revision <int>`, `--patch <patch.json>` | `{"revision", "step", "status": "updated"\|"reverted"}` |
| `advance` | `--path`, `--expect-revision <int>` | `{"revision", "step", "status": "advanced"}` |
| `approve` | `--path`, `--expect-revision <int>`, `--block changes\|sprint_plan`, `--message-ref` | `{"revision", "step", "status": "approved"}` |

Exit 0 on success. A `ValueError`, `OSError`, `KeyError` or `TypeError` prints `{"ok": false, "error": <msg>}` to stderr and exits 1. Argparse usage errors exit 2. The module docstring's CLI list omits `approve`.

## State Management

- Expected revision: `update`, `advance` and `approve` refuse when `--expect-revision` differs from `run.revision`. Each success raises the revision by one and refreshes `updated_at`.
- `update`: replaces named blocks only; `status` is `reverted` when a chain dependent outside the patch already held content (a real go-back), else `updated`. Written blocks are removed from `stale`. `approval` is set to null on every update.
- Build chain `CHAIN`: idea, today, playback, decisions, ticket_set_ref, readiness, posted. The earliest changed chain block stales every later one (minimum-affected-block rule). Outside the chain: run, setup, glossary, assumptions, outcome.
- Mode chain `MODE_CHAIN`: refine only, existing then changes. Size and plan have no chain.
- Required blocks: build `REQUIRED` = 0 setup, 1 idea, 2 today, 3 playback, 4 decisions and outcome, 5 ticket_set_ref and readiness, 6 posted. Other modes use `MODE_REQUIRED` indexed by step: refine (existing, changes), size (sizing), plan (sprint_plan). `required_for` is the single source (RULE-11).
- `advance`: refuses missing or stale required blocks; the final step is 6 in build mode and the length of the mode sequence otherwise.
- `approve`: only `APPROVABLE` blocks (changes, sprint_plan); needs a non-empty message ref, a non-empty, non-stale block. See [approval-digests](../approval-digests/technical.md).

## Error Codes

None as structured codes; `ValueError` messages: "Stale revision: expected X, current Y.", "Patch must name at least one documented block.", "Patch touches undocumented blocks: ...", "Cannot advance step N: missing ...", "Cannot advance step N: stale ...", "Already at the final step.", "Only changes and sprint_plan may be approved.", "An approval needs the message reference of the explicit apply it.", "Cannot approve the empty X block.", "Cannot approve a stale X block; redo it first.", plus the `validate` messages.

## Dependencies

| Kind | Dependency |
|---|---|
| Python imports | `canonical` (`load`, `now`, `digest`, `text`) |
| Modules | None (foundation). Consumers: idea-journey, ticket-refinement, work-sizing, sprint-planning via `build/skills.yml` imports |
| Host capabilities | File creation in a working folder for the record where the host can create files, with download for resume (REC-5); where the host cannot create files, the record is kept as a chat summary instead, shown on request and on resume, so the memory survives without a file (REC-2). The refine, size and plan records follow the same rule |

## Configuration

None. Maps are module constants: `BLOCKS`, `CHAIN`, `REQUIRED`, `MODE_REQUIRED`, `MODE_CHAIN`, `APPROVABLE`, `RUN_ID_ALPHABET`.

## Testing Entry Points

`tests/scripts/test_record.py`:

- `InitTest`: `test_init_shape`, `test_minted_run_id_matches_pattern`
- `ExpectedRevisionTest`: `test_stale_revision_refused`, `test_matching_revision_accepted`
- `GoBackTest` (AC-7): `test_go_back_raises_revision_and_marks_only_dependents_stale`, `test_unrelated_decision_survives_a_goal_change`, `test_rewriting_a_stale_block_clears_its_staleness`, `test_update_pops_bound_approval`
- `InvalidationMapTest` (INV-11): `test_ticket_set_ref_change_stales_exactly_readiness_and_posted`, `test_readiness_change_stales_only_posted`
- `AssumptionsTest`: `test_assumptions_block_stored` (AC-29)
- `AdvanceTest`, `UndocumentedBlockTest`, `BuildModeUnchangedTest` (INV-1), `RefineModeTest`, `SizeAndPlanModeTest`, `ApprovalTest`

Eval: `tests/evals/scenarios/s1.yml#ac-15` (resume from a downloaded record).
