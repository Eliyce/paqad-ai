# Refine an existing ticket: technical

## Module Boundaries

Owned paths (module `ticket-refinement`, feature `refine-a-ticket`):

| Path | Role |
|---|---|
| `skills/refine-ticket/SKILL.md` | Entry skill (FR-13); may be started directly |
| `skills/refine-ticket/references/refine-procedure.md` | Nine-step procedure (EDT-1 to EDT-10) |
| `skills/refine-ticket/references/rich-content.md` | Rich-content definition and append rule (EDT-7) |
| `skills/refine-ticket/scripts/diff_ticket.py` | Change-set builder; writes nothing to any tracker |

## Data Contracts

`diff_ticket.py` inputs (from its docstring):

```json
// snapshot.json
{ "key": "ABC-12", "fields": { "summary": "", "description": "", "labels": [], "parent": "", "links": [] }, "last_updated": "<ISO 8601>" }

// proposed.json
{ "ticket_key": "ABC-12", "fields": { "<subset of the five fields>": "..." },
  "new_children": [ { "title": "", "parent_epic": "", "link_to": "" } ],
  "description_mode": "section | comment" }

// live.json
{ "last_updated": "<ISO 8601>" }
```

Output:

```json
{ "ok": true, "conflict": false,
  "change_set": { "ticket_key": "", "changes": [ { "field": "", "before": null, "after": null, "op": "replace | append_section | append_comment" } ],
                  "new_children": [ { "title": "", "parent_epic": "", "link_to": "" } ],
                  "digest": "<sha256>" },
  "issues": [ { "code": "", "path": "", "message": "" } ] }
```

Record blocks (refine mode, REC-1): `existing` (list of ticket snapshots with last-updated times) and `changes` (the approved change set and new children, with its digest). Approval stored in the record's `approval` field as `{"block": "changes", "digest", "message_ref"}`.

## Script Interfaces

`diff_ticket.py --snapshot <snapshot.json> --proposed <proposed.json> [--live <live.json>]`

| Item | Value |
|---|---|
| stdout | `{"ok", "conflict", "change_set", "issues"}` |
| Exit | 0 on a clean, conflict-free change set (including when `RICH_CONTENT_GUARD` is reported); 1 on a conflict, a disallowed field, or an error |
| Errors | `ValueError`, `OSError`, `KeyError`, `TypeError` print `{"ok": false, "error"}` to stderr, exit 1 |
| Side effects | None; standard library only, no network |

Behaviour:

- Conflict first: with `--live`, if `live.last_updated > snapshot.last_updated` (string comparison), returns `conflict: true`, `change_set: null`.
- Field limit: any proposed field outside `summary`, `description`, `labels`, `parent`, `links` refuses the whole set (`change_set: null`).
- Unchanged fields are dropped; lists compare order-insensitively.
- Rich guard: if the snapshot description matches any rich marker, the description op becomes `append_comment` when `description_mode` is `comment`, else `append_section`.
- `new_children` are copied through (`title`, `parent_epic`, `link_to`) without validation.
- `digest` = `canonical.digest` of the change set minus `digest`.

Other scripts the skill calls (owned elsewhere): `check_prose.py --ticket-set <draft.json>` (`tracker-checks`), `check_readback.py --approved <change-set.json> --created <live-after.json>` (`tracker-checks`), `record.py` and `check_record.py` (`discovery-record`).

`check_readback.py` understands the change set directly (its `compare_change_set` path): it checks only the changed fields of the edited ticket (identified by `ticket_key`) plus any `new_children`, treats a `replace` op as equality and an `append_section` or `append_comment` op as "the after-text is present", uses subset for labels and links, and never flags an unrelated live issue. The live-after file reads leniently, accepting either the created-issue shape (`title`, `body`) or the snapshot `fields` shape (`summary`, `description`).

## State Management

- Record created with `record.py init --mode refine`. `MODE_REQUIRED["refine"] = ("existing", "changes")`: step 0 needs `existing`, step 1 needs `changes`; final step is 2.
- `MODE_CHAIN["refine"] = ("existing", "changes")`: rewriting `existing` (re-snapshot) marks `changes` stale.
- Approval: `record.py approve --block changes --message-ref <ref>` binds `block_digest(changes)` (digest field excluded, same rule as `diff_ticket.py`). It refuses an empty or stale block and a revision mismatch. Every `record.py update` sets `approval` to null, so an edit after approval voids it (AC-34).
- Every update states `--expect-revision`; an older revision is refused (REC-4).
- Conflict baseline is the snapshot `last_updated`; it is not re-taken unless the user means to re-baseline.

## Error Codes

| Code | Source | Meaning |
|---|---|---|
| `CONFLICT` | `diff_ticket.py` | Live ticket updated after the snapshot; change set withheld (exit 1) |
| `FIELD_NOT_ALLOWED` | `diff_ticket.py` | Proposed field outside the allowed five; change set refused (exit 1) |
| `RICH_CONTENT_GUARD` | `diff_ticket.py` | Snapshot description is rich; description op is an append, and the message names the markers and op (informational, exit 0) |
| `MISSING`, `STALE` | `check_record.py` | Required refine-mode block missing or stale |

## Dependencies

| Kind | Dependency |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md`, `references/writing-rules.md`, `references/plain-language.md`, `references/tracker-profiles/jira.md`, `scripts/canonical.py`, `scripts/record.py`, `scripts/check_record.py`, `scripts/check_prose.py`, `scripts/check_readback.py` |
| Other modules | `discovery-record`, `tracker-checks`, `conversation-standards`; hands larger work to `idea-journey` (`product-discovery`) |
| Host capabilities | Tracker connector: read issue, edit issue, add comment, create issue and create link (split), search; reading project documents for the contradiction check; running Python scripts |

## Configuration

Rich-content markers (regular expressions in `diff_ticket.py`):

| Marker | Matches |
|---|---|
| image | Markdown `![`, Jira `!name.ext!` (png, jpg, jpeg, gif, svg, bmp, webp), ADF `"type":"media` |
| panel | Jira `{panel`, ADF `"type":"panel"`, a line starting with `:::` |
| mention | Jira `[~`, ADF `"type":"mention"`, an `@` name |
| merged_cell_table | `colspan` or `rowspan` |

`ALLOWED_FIELDS` and `ALLOWED_OPS` constants fix the field and op lists. Deny-list: `references/plain-language.md`.

## Testing Entry Points

| Entry point | What it covers |
|---|---|
| `tests/scripts/test_refine.py` `ConflictTest`: `test_live_newer_than_snapshot_flags_conflict_and_withholds`, `test_live_not_newer_is_clean` | AC-31, EDT-6 |
| `RichContentGuardTest`: `test_image_and_panel_force_append_not_replace`, `test_comment_mode_selects_append_comment`, `test_plain_description_replaces_normally` | AC-32, EDT-7 |
| `SplitStructureTest.test_split_adds_linked_children_under_same_epic_and_keeps_original` | AC-33, EDT-8 |
| `DigestTest`: `test_edit_changes_digest_voiding_approval`, `test_digest_is_canonical_over_set_minus_digest` | AC-34, EDT-5 |
| `FieldLimitTest.test_field_outside_the_allowed_five_is_refused` | EDT-4 |
| `NoDeleteOrCloseTest.test_every_emitted_op_is_an_allowed_op` | EDT-9 |
| `tests/scripts/test_record.py`: `test_mode_required_gates_advance`, `test_staleness_is_mode_local_and_never_touches_the_build_chain`, `test_approve_binds_the_block_digest`, `test_edit_after_approval_voids_it`, `test_approve_refuses_unknown_block_and_stale_revision` | Refine-mode blocks, staleness and approval (module `discovery-record`) |
| `tests/scripts/test_authoring.py` `TriggerHygieneTest.test_entry_skills_present`, `ChecklistFallbackTest.test_each_script_bearing_skill_has_fallback` | Entry skill and PLG-6 fallback |
| `tests/evals/scenarios/s1b.yml` `ac-30`, `ac-33` | Diagnosis with evidence and before/after; split with original kept (fixtures under `tests/evals/fixture-repo/tracker/`) |
