# Post approved tickets: technical

## Module Boundaries

Owned paths (module `ticket-posting`, feature `post-tickets`):

| Path | Role |
|---|---|
| `skills/post-tickets/SKILL.md` | Step 6 skill instructions; by-hand checklist |
| `skills/post-tickets/references/post-procedure.md` | Ordered procedure, receipt-state table, lost-reply handling |
| `skills/post-tickets/scripts/plan_posting.py` | Plan builder and receipt lifecycle (never posts itself) |

`plan_posting.py` only plans and records. The host executes each returned operation against the tracker connector. Read-back comparison is done by `check_readback.py` (module `tracker-checks`).

## Data Contracts

State file passed as `--state` (shape from the module docstring and `tests/scripts/test_posting.py` `fresh_state`):

```json
{
  "ticket_set": { "...": "ticket-set.json content" },
  "setup": { "run_label": "dr-20261005-7k2q" },
  "connector": { "actions": ["createIssueLink"] },
  "approval": { "digest": "<current ticket digest>", "message_ref": "<ref of the explicit post it>" },
  "plan": { "ticket_digest": "", "link_action": "", "operations": [] },
  "receipts": { "<op id>": { "status": "in_flight | created | uncertain | not_applied", "result": { "key": "ABC-1" }, "recorded_at": "" } },
  "posted": { "issues": [ { "ref": "E1", "issue_key": "ABC-1", "status": "created" } ], "read_back": {} }
}
```

Operation shape: `{"id", "action", "kind", "item_ref", "arguments"}`.

| Kind | id | action | arguments |
|---|---|---|---|
| `epic` | `create-E<n>` | `createIssue` | `project`, `issuetype` (epic_type), `summary`, `description`, `labels` (epic labels plus `paqad-discovery` and run label) |
| `story` | `create-E<n>-T<m>` | `createIssue` | as epic with `story_type`, `labels` (`paqad-discovery`, run label), `parent` (result ref to the epic op) |
| `link` | `link-<ticket>-<dep>` | resolved link action | `type: "Depends"`, `inward` and `outward` result refs |
| `read_back` | `read-back` | `readBack` | `keys`: result refs to every create op |

Result reference: `{"$result": {"operation": "<op id>", "path": ["key"]}}`, resolved only from a receipt with status `created` and only to a scalar.

Receipt file for `record`: `{"status": "created | uncertain | not_applied", "result": {"key": ...}, ...}`. Tracker issues file for `reconcile`: list of `{"key", "labels": [], "item_ref"}`.

Record block written (`record-template.md`): `posted` = `{"issues": [{"ref", "issue_key", "status"}], "read_back": ...}`.

## Script Interfaces

`plan_posting.py <subcommand> --state <state.json> [...]`. Standard library only, no network.

| Subcommand | Extra args | Writes state | stdout |
|---|---|---|---|
| `plan` | none | yes, sets `plan` | the plan `{"ticket_digest", "link_action", "links_by_hand", "depends_on_lines", "operations"}` |
| `next` | none | no | `{"id", "action", "arguments"}` with result refs resolved |
| `claim` | none | yes, receipt `in_flight` | `{"id", "action", "arguments"}` |
| `record` | `--operation <id> --receipt <receipt.json>` | yes | stored receipt (with `recorded_at`) |
| `reconcile` | `--operation <id> [--tracker-issues <found.json>]` | yes | found: `{"status": "created", "issue_key", "item_ref", "duplicate_created": false}`; not found: `{"status": "ask_user", "item_ref", "retried": false, "message"}` |

Exit codes: 0 on success; 1 with `{"ok": false, "error": "<message>"}` on stderr for `ValueError`, `OSError`, `KeyError`, `TypeError`.

Guards in `next` and `claim`: plan exists; `plan.ticket_digest` equals the current ticket digest; `approval.digest` equals the current digest and `approval.message_ref` is non-empty; no operation is `in_flight` or `uncertain`. Operations with `created` or `not_applied` are skipped.

Link action resolution (AC-18): `createJiraIssueLink` if listed in `connector.actions`, else `createIssueLink` (also the default when nothing is advertised).

Link-by-hand fallback (U-3): `link_action_available(connector)` returns false only when the connector advertises its actions but names no link action; a connector that advertised nothing is treated as having one, so the default path is unchanged. When no link action is available the plan sets `links_by_hand` true, emits no `link` operations, and instead appends a `depends_on_line(dep)` (`"Depends on <dep>"`) to each dependent story's `description` so the dependency is never lost, and lists each as `{"ticket", "depends_on", "text"}` in `depends_on_lines`. On read-back the by-hand links may be absent; that is reported as such, not as a failure.

`check_readback.py --approved <ticket-set.json> --created <created-issues.json>` (module `tracker-checks`) returns `{"ok", "status": "match | partial | mismatch", "differences"}`, exit 0 only on `match`.

## State Management

- Digest: `canonical.digest` of the ticket set minus `digest`. Plan and approval both bind to it; an edit makes `next` refuse with a stale-plan error, and after re-planning, with a missing-approval error (AC-14).
- Receipt transitions: none -> `in_flight` (`claim`) -> `created` or `uncertain` (`record`); `uncertain` -> `created` (`reconcile` found) or stays `uncertain` with `ask_user`. `not_applied` may be recorded without a claim. A `created` receipt is final and cannot be re-recorded.
- `created` (from `record` or `reconcile`) writes `{ref, issue_key, status}` into `state.posted.issues` for epic and story ops only.
- `posted.read_back` is not filled by the script; the read-back result comes from `check_readback.py`.
- The thirty-second wait before reconcile is an instruction rule (`post-procedure.md`); the script does not time it.
- Record: step 6 requires the `posted` block (`record.py` `REQUIRED[6]`). `posted` is last in `CHAIN`, so a change to `ticket_set_ref` or `readiness` stales it. The skill does not import `record.py`; copying `state.posted` into the record goes through the coordinator (`idea-journey`). How that copy is made is not stated in source.

## Error Codes

`plan_posting.py` emits no coded issues; failures are error messages:

| Message (prefix) | Meaning |
|---|---|
| `No plan yet` | `next` or `claim` before `plan` |
| `Stale plan` | Ticket set changed since the plan was built |
| `No approval bound to the current ticket-set digest` | Missing, mismatched or reference-less approval |
| `Reconcile the pending operation before another write` | An op is `in_flight` or `uncertain` |
| `All operations already completed.` | Nothing left to run |
| `Receipt status must be created, uncertain or not_applied.` | Bad receipt status |
| `A created receipt is never reset to retry` | Attempt to overwrite a created receipt |
| `Claim the operation before recording its result` | `created` or `uncertain` without a prior claim |
| `Reconcile applies only to an uncertain operation` | Reconcile on a non-uncertain op |
| `Unknown operation id` | Op id not in the plan |
| `Result reference to an operation without a verified success receipt` | Dependent op whose parent create is not `created` |
| `Result references must resolve to a scalar identifier.` | Reference path ends on a list or object |

`reconcile` returning `"status": "ask_user"` is a normal result (exit 0), not an error. `check_readback.py` issue codes (`MISSING`, `DIFF`, `EXTRA`) are documented in module `tracker-checks`.

## Dependencies

| Kind | Dependency |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md`, `references/tracker-profiles-jira.md`, `scripts/canonical.py`, `scripts/check_readback.py` |
| Other modules | `tracker-checks` (read-back, Jira profile), `discovery-record` (digest, `posted` block), `conversation-standards` (voice), `ticket-drafting` (input set and readiness) |
| Host capabilities | Tracker connector actions: create issue, create link, read issue, search, edit issue (additional-fields parent route); creating a preview file; running Python scripts |

## Configuration

- `SHARED_LABEL = "paqad-discovery"` in `plan_posting.py`.
- Run label from `state.setup.run_label`.
- Link type is fixed to `"Depends"` in the plan.
- Connector actions from `state.connector.actions`.
- Tool-name variants: `shared/references/tracker-profiles-jira.md`.

## Testing Entry Points

| Entry point | What it covers |
|---|---|
| `tests/scripts/test_posting.py` `PlanOrderTest`: `test_ordered_plan_with_parents_and_links_last`, `test_full_run_creates_every_issue_in_order` | AC-13 |
| `LostReplyTest`: `test_lost_reply_but_created_reconciles_without_duplicate`, `test_lost_reply_not_found_asks_user_without_retry`, `test_created_receipt_never_reset` | AC-11, AC-12, PUB-5 |
| `ApprovalBindingTest`: `test_stale_plan_refuses_after_edit`, `test_edit_voids_digest_bound_approval` | AC-14 |
| `LinkActionTest.test_both_link_action_names_resolve` | AC-18 |
| `LinksByHandTest`: `test_no_link_action_renders_depends_on_text`, `test_link_action_present_is_unchanged`, `test_unadvertised_connector_keeps_default_link_path` | U-3 |
| `ReadbackTest`: `test_match`, `test_partial_when_one_issue_missing`, `test_partial_when_body_differs`, `test_mismatch_when_nothing_created`, `test_whitespace_and_list_markers_normalised` | PUB-6 |
| `tests/scripts/test_authoring.py` `ChecklistFallbackTest.test_each_script_bearing_skill_has_fallback` | PLG-6 |
| `tests/evals/scenarios/s1.yml` `ac-10`, `ac-47`, `ac-9`, `ac-2` | Vague approval, compact preview, duplicate shown, no-write tracker |
