# Check documents and tracker are ready: technical

## Module Boundaries

| Path | Owned |
|---|---|
| `skills/get-connected/SKILL.md` | Yes: step 0 procedure and checklist fallback |
| `skills/get-connected/references/connect-tracker.md` | Yes: write-access check, setup discovery, actions not tool names, run-label warning |
| `shared/references/connect-repository.md` | No: owned by project-grounding (get-the-documents); copied in as `references/connect-repository.md`: choosing the repository, reading documents by capability, the GRD-1 check mapped to the three evidence levels, never-read list |
| `shared/references/evidence-levels.md` | No: owned by project-grounding (find-related-areas); copied in as `references/evidence-levels.md`: the three evidence levels and their detection, the source line, the informational nudge and the code-only finder (GRD-12 to GRD-16) |
| `shared/scripts/check_onboarded.py` | No: owned by project-grounding (get-the-documents); copied in as `scripts/check_onboarded.py`: the GRD-1 check, read as the three evidence levels |
| `shared/references/tracker-profiles-jira.md`, `shared/references/tracker-profiles-github.md` | No: owned by tracker-checks |

Step skill: its description says it runs when the journey directs it (PLG-8).

## Data Contracts

Writes the `setup` block (content produced here; written by `product-discovery` through `record.py`):

```json
{
  "repository": "acme-shop", "repository_state": "ready", "evidence_level": "project-docs",
  "tracker_kind": "jira", "project_key": "ABC",
  "epic_type": "Epic", "story_type": "Story",
  "issue_types": [], "required_fields": {}, "link_types": [],
  "size_field_id": null, "sprint_field_id": null,
  "can_create": false, "run_label": "dr-20261005-7k2q"
}
```

`run_label` is `run.run_id` in lowercase. `repository` is the chosen repository's name as the tool or attachment shows it (`""` when none is shown), `repository_state` is `ready` or `partly-ready`, and `evidence_level` is `project-docs`, `docs-and-code` or `code-only` (GRD-12); all are chosen by the rules in `references/connect-repository.md` and `references/evidence-levels.md` and never hold credentials (REC-6).

## Script Interfaces

`scripts/check_onboarded.py` (shared, stdlib only, no network, read-only): `check_onboarded.py [--root <repo-root>]`. Exit 0 with `state` `ready` (project-docs) or `partly-ready` (docs-and-code), exit 1 with `not-set-up` (read as code-only, not a stop) and the message, exit 2 on a usage error. The script is byte-identical (GM-8); the levels live in `references/evidence-levels.md`. The full contract is in [project-grounding get-the-documents api.md](../../../project-grounding/features/get-the-documents/api.md).

Tracker checks are instruction-only, done through the host connector.

## State Management

Produces `setup`, the step 0 required block (`record.REQUIRED[0]`). `setup` is outside the go-back chain, so a later goal change never stales it. Revision and advance rules are those of the coordinator.

## Error Codes

None. The script returns only `ok`, `state`, a fixed message and `unknown_areas`.

## Dependencies

| Kind | Item |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md`, `references/connect-repository.md`, `references/evidence-levels.md`, `references/tracker-profiles-jira.md`, `references/tracker-profiles-github.md`, `scripts/check_onboarded.py` |
| Modules | project-grounding (repository rule, readiness check and evidence levels), tracker-checks (Jira and GitHub profiles), conversation-standards, discovery-record (record written by the coordinator) |
| Host capabilities | Reading repository files or user-attached `docs/`; optionally a tool that lists reachable repositories (U-18); tracker connector with create-issue, list link types, list fields for an issue type; Python 3.9 for the script (optional) |

## Configuration

| Item | Where |
|---|---|
| Tracker action names per connector version | `references/tracker-profiles-jira.md` |
| Never-read paths (`.paqad/`, `docs/instructions/rules/`, secrets, env files) | `references/connect-repository.md` |

## Testing Entry Points

| Kind | Entry point |
|---|---|
| Unit | `tests/scripts/test_onboarded.py`: the three-state check (listed under project-grounding get-the-documents) |
| Authoring | `tests/scripts/test_authoring.py`: `FixtureRepoTest` (AC-10), `TriggerHygieneTest` (AC-19), `ChecklistFallbackTest` (AC-16), `ThreeStateChecklistTest` (by-hand three-state check), `RecordRepositoryFieldsTest` (`setup.repository` fields) |
| Eval scenarios | `s1.yml` `ac-2` (tracker without write: `csv-export-offered`); `repo-selection.yml` (repository choice, docs-and-code, switch); `generic-mode.yml` `gm-66` (a size on a code-only repository carries the level) |
