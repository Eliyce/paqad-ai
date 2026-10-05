# Approvals bound to content: technical

## Module Boundaries

Owned path: `shared/scripts/canonical.py`. It has no CLI and no import side effects. The `approve` subcommand and `block_digest` that use it live in `shared/scripts/record.py` ([record-lifecycle](../record-lifecycle/technical.md)).

## Data Contracts

- Digest: sha256 hex of `json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)` encoded as UTF-8.
- Issue: `{"code", "path", "message"}`.
- Result printed by `result(errors)`: `{"ok": not errors, "issues": errors}`.
- Record approval: `{"block": "changes"|"sprint_plan", "digest": <block_digest>, "message_ref": <str>}`, where `block_digest` is the digest of the block with its own `digest` key removed (INV-8).

## Script Interfaces

None: `canonical.py` is a library. Functions:

| Function | Contract |
|---|---|
| `digest(value)` | Canonical sha256 hex; raises `ValueError` on NaN or infinity |
| `load(path)` | Parsed JSON of a UTF-8 file |
| `now()` | Current UTC time, ISO 8601 |
| `text(value)` | True for a non-empty, non-whitespace string |
| `issue(code, path, message)` | One structured finding |
| `result(errors)` | Prints the result JSON; returns 1 if any error, else 0 |

## State Management

Digest-bound approvals (REC-7):

| Approved content | Digest computed by | Basis |
|---|---|---|
| Ticket set | `check_ticket_set.py`, `plan_posting.current_digest` (whole set minus `digest`) | PUB-2 |
| Refine change set | `diff_ticket.py` and `record.block_digest` | EDT-5 |
| Sprint plan | `fit_sprint.plan_digest` (minus `digest` and `ok`) and `record.block_digest` | SPR-6 |

`record.apply_update` sets `approval` to null on every write, so any edit voids it (AC-34).

## Error Codes

None emitted here. `issue` and `result` are the shape other scripts use for their codes (for example `MISSING`, `STALE` in `check_record.py`, `STALE_DIGEST` in `check_ticket_set.py`).

## Dependencies

| Kind | Dependency |
|---|---|
| Python imports | Standard library only (`hashlib`, `json`, `datetime`, `pathlib`) |
| Importers | `record.py`, `check_record.py`, `check_prose.py`, `check_readback.py`, `check_ticket_set.py`, `plan_posting.py`, `export_csv.py`, `diff_ticket.py`, `compare_sizes.py`, `fit_sprint.py` |
| Build | Declared as `scripts/canonical.py` for product-discovery, check-tickets, post-tickets, refine-ticket, size-work, plan-sprint |

## Configuration

None. PLG-5: the 0.2.0 file locks, data root, atomic writer and history helpers are not ported.

## Testing Entry Points

`tests/scripts/test_canonical.py`:

- `DigestTest`: `test_digest_is_deterministic`, `test_digest_is_key_order_independent`, `test_digest_matches_reference_formula`, `test_digest_changes_with_content`, `test_digest_rejects_nan`
- `LoadTest`: `test_load_reads_json`
- `HelperTest`: `test_text_truth`, `test_text_rejects_empty_and_non_strings`, `test_issue_shape`, `test_now_is_iso_utc`
- `ResultTest`: `test_clean_result`, `test_failing_result`

Also `tests/scripts/test_record.py` `ApprovalTest` (`test_block_digest_excludes_its_own_digest_field`, `test_approve_binds_the_block_digest`, `test_edit_after_approval_voids_it`, `test_sprint_plan_approval_digest`, `test_approve_refuses_unknown_block_and_stale_revision`, `test_approve_refuses_empty_block`).
