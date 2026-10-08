# Check documents and tracker are ready: technical

## Module Boundaries

| Path | Owned |
|---|---|
| `skills/get-connected/SKILL.md` | Yes: step 0 procedure and checklist fallback |
| `skills/get-connected/references/connect-repository.md` | Yes: reading documents by capability, onboarded check, never-read list |
| `skills/get-connected/references/connect-tracker.md` | Yes: write-access check, setup discovery, actions not tool names, run-label warning |
| `skills/get-connected/scripts/check_onboarded.py` | Yes: GRD-1 check |
| `shared/references/tracker-profiles-jira.md` | No: owned by tracker-checks |

Step skill: its description says it runs when the journey directs it (PLG-8).

## Data Contracts

Writes the `setup` block (content produced here; written by `product-discovery` through `record.py`):

```json
{
  "tracker_kind": "jira", "project_key": "ABC",
  "epic_type": "Epic", "story_type": "Story",
  "issue_types": [], "required_fields": {}, "link_types": [],
  "size_field_id": null, "sprint_field_id": null,
  "can_create": false, "run_label": "dr-20261005-7k2q"
}
```

`run_label` is `run.run_id` in lowercase.

## Script Interfaces

`scripts/check_onboarded.py` (stdlib only, no network, read-only):

| Item | Value |
|---|---|
| Invocation | `check_onboarded.py [--root <repo-root>]` (default: current working folder) |
| Pass | stdout `{"ok": true}`, exit 0 |
| Fail | stdout `{"ok": false, "message": "<STOP_MESSAGE>"}`, exit 1 |
| Rule | `docs/instructions/registries/modules.md` is a file and `docs/modules/*/index/summary.md` matches at least one file |
| Functions | `is_onboarded(root)`, `main(argv)`; constant `STOP_MESSAGE` |

Tracker checks are instruction-only, done through the host connector.

## State Management

Produces `setup`, the step 0 required block (`record.REQUIRED[0]`). `setup` is outside the go-back chain, so a later goal change never stales it. Revision and advance rules are those of the coordinator.

## Error Codes

None. The script returns only the `ok` flag and the fixed stop message.

## Dependencies

| Kind | Item |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md`, `references/tracker-profiles-jira.md` |
| Modules | tracker-checks (Jira profile), conversation-standards, discovery-record (record written by the coordinator) |
| Host capabilities | Reading repository files or user-attached `docs/`; tracker connector with create-issue, list link types, list fields for an issue type; Python 3.9 for the script (optional) |

## Configuration

| Item | Where |
|---|---|
| Tracker action names per connector version | `references/tracker-profiles-jira.md` |
| Never-read paths (`.paqad/`, `docs/instructions/rules/`, secrets, env files) | `references/connect-repository.md` |

## Testing Entry Points

| Kind | Entry point |
|---|---|
| Unit | `tests/scripts/test_onboarded.py`: `OnboardedTest` (`test_real_fixture_is_onboarded`, `test_cli_passes_on_fixture`, `test_message_constant_is_exact`), `NotOnboardedTest` (`test_missing_modules_registry_fails`, `test_missing_module_summary_fails`, `test_empty_tree_fails`, `test_cli_fail_payload_carries_exact_message`) (AC-1) |
| Authoring | `tests/scripts/test_authoring.py`: `FixtureRepoTest` (AC-10), `TriggerHygieneTest` (AC-19), `ChecklistFallbackTest` (AC-16) |
| Eval scenarios (`s1.yml`) | `ac-2` (tracker without write: `csv-export-offered`) |
