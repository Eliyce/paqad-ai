# Check the ticket set: technical

## Module Boundaries

Owned paths (module `ticket-drafting`, feature `check-tickets`):

| Path | Role |
|---|---|
| `skills/check-tickets/SKILL.md` | Step skill instructions; by-hand fallback |
| `skills/check-tickets/references/review-checklist.md` | Six judgment checks (REQUIREMENTS 8.5), the sixth judging each ticket as a user story against `references/user-stories.md` (TKT-6) |
| `skills/check-tickets/scripts/check_ticket_set.py` | Structure, shape and digest validator |

The prose checker `check_prose.py` is owned by module `tracker-checks` and only invoked here. The skill is a step skill and is not started directly.

## Data Contracts

- Input: `ticket-set.json` (shape in `skills/write-tickets/assets/ticket-set.schema.json`; see feature `draft-tickets`).
- Output record block `readiness` (`skills/product-discovery/assets/record-template.md`):

```json
{ "status": "passed | open", "checks": [], "reviewer": "", "notes": "" }
```

`notes` includes the duplicate matches shown to the user. The inner shape of `checks` entries is not defined in source.

- Script result (via `canonical.result`): `{"ok": <bool>, "issues": [{"code", "path", "message"}]}`.

## Script Interfaces

`check_ticket_set.py`

| Item | Value |
|---|---|
| Usage | `check_ticket_set.py --ticket-set <ticket-set.json> [--schema <ticket-set.schema.json>]` |
| stdout | `{"ok", "issues"}` |
| Exit | 0 clean; 1 on any issue or on a load error |
| Errors | `ValueError`, `OSError`, `KeyError`, `TypeError` print `{"ok": false, "error": ...}` to stderr, exit 1 (the error text is a Python `repr`, so the stderr line is not guaranteed strict JSON) |
| Side effects | None. Read-only, standard library only, no network |

Check order: shape (short-circuits on any shape error), then digest, then structure. `--schema` is parsed but not used; validation is hand-coded.

Shape checks cover: object type; non-empty `run_id`, `digest`; integer (non-bool) `revision`; `tracker` with non-empty `kind`, `project_key`, `epic_type`, `story_type`; non-empty `epics` list; per epic non-empty `ref`, `title`, `body_markdown`, list `labels`, list `tickets`; per ticket non-empty `ref`, `title`, `body_markdown`, list `done_when`, list `depends_on`, `assignee_hint` key present. Schema patterns (`run_id`, `digest`, refs), the 80-character title limit and `additionalProperties: false` are not checked by the script.

`check_prose.py` (owned by `tracker-checks`) is run as `check_prose.py --ticket-set <ticket-set.json>`; output `{"ok", "issues": [{"code", "path", "message", "suggestion"}]}`, exit 0 clean, 1 on any finding.

## State Management

- Reads `ticket-set.json` and the record's `today` block plus project documents (judgment check 3).
- Writes the `readiness` block. The skill does not import `record.py`; the write goes through the coordinator (`idea-journey`).
- Chain position (`shared/scripts/record.py` `CHAIN`): `... -> ticket_set_ref -> readiness -> posted`. A change to `ticket_set_ref` stales `readiness`; a change to `readiness` stales `posted`.
- Step 5 exit needs `ticket_set_ref` and `readiness` present and not stale (`REQUIRED[5]`, checked by `check_record.py`).
- `post-tickets` proceeds only once `readiness.status` is `passed` (instruction rule in `SKILL.md`; no script enforces it).

## Error Codes

From `check_ticket_set.py`:

| Code | Meaning |
|---|---|
| `SCHEMA` | Shape error against the REQUIREMENTS 8.3 structure (missing or wrong-typed field) |
| `STALE_DIGEST` | Stored `digest` does not equal the recomputed canonical digest |
| `EMPTY_EPIC` | An epic holds no tickets |
| `TWO_EPICS` | A ticket ref appears under two epics |
| `DONE_WHEN` | `done_when` is not a list of 2 to 8 items |
| `DUPLICATE_TITLE` | Two epics or tickets share a title (after trim) |
| `DANGLING_DEPENDENCY` | A `depends_on` entry is not a ticket ref in the set |
| `DEPENDENCY_CYCLE` | The `depends_on` graph has a cycle (depth-first search over known refs) |

`check_prose.py` codes map to TKT-1, TKT-2 and TKT-3; see module `tracker-checks`.

## Dependencies

| Kind | Dependency |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md`, `references/plain-language.md`, `references/user-stories.md`, `scripts/canonical.py`, `scripts/check_prose.py` |
| Other modules | `tracker-checks` (prose check), `discovery-record` (canonical digest, `readiness` block), `conversation-standards` (voice, deny-list) |
| Host capabilities | Running Python scripts where available; tracker connector search action (read-only) for the duplicate search |

## Configuration

- Deny-list: `references/plain-language.md`, the default for `check_prose.py --denylist`.
- No other configuration.

## Testing Entry Points

| Entry point | What it covers |
|---|---|
| `tests/scripts/test_tickets.py` `CheckTicketSetTest`: `test_valid_set_passes`, `test_stale_digest`, `test_empty_epic`, `test_ticket_under_two_epics`, `test_done_when_out_of_range`, `test_duplicate_titles`, `test_dangling_dependency`, `test_dependency_cycle`, `test_shape_error_short_circuits` | Every structure failure mode |
| `tests/scripts/test_tickets.py` `CheckProseTest`: `test_em_dash_and_function_name_blocked_with_fixes`, `test_fixed_set_passes`, `test_quoted_code_and_url_content_not_rewritten`, `test_jargon_flagged_with_plain_replacement`, `test_single_document_scan` | AC-8 and TKT-3 |
| `tests/scripts/test_user_stories.py` `StoryProseTest`, `StoryStructureTest` | AC-75: a story set passes both checks; a confirmed permission key passes; code in a criterion or on a story line is flagged once at its line; nine criteria fail |
| `tests/scripts/test_authoring.py` `ChecklistFallbackTest.test_each_script_bearing_skill_has_fallback` | PLG-6 checklist fallback present |
| `tests/evals/scenarios/s1.yml` `ac-9` | Duplicate shown before posting |
