# Step order, status, resume and going back: technical

## Module Boundaries

| Path | Owned |
|---|---|
| `skills/product-discovery/SKILL.md` | Yes: entry skill, step table, record usage, going back, side questions, resume, checklist fallback |
| `skills/product-discovery/references/journey.md` | Yes: per-step purpose, exit conditions, go-back invalidation map |
| `skills/product-discovery/assets/record-template.md` | Lives in this skill folder, but the module map assigns it to discovery-record |
| `shared/scripts/record.py`, `check_record.py`, `canonical.py` | No: owned by discovery-record, copied in at build time |

`product-discovery` is an entry skill (PLG-8). Steps 5 and 6 are run by `write-tickets`, `check-tickets` (ticket-drafting) and `post-tickets` (ticket-posting).

## Data Contracts

The discovery record, one JSON object per run (REC-1). Template: `skills/product-discovery/assets/record-template.md`. Build-mode blocks used by the journey:

| Block | Filled by step | Shape (abridged) |
|---|---|---|
| `run` | managed | `{run_id: "DR-YYYYMMDD-XXXX", revision, step: 0..6, updated_at, mode: "build"}` |
| `setup` | 0 | tracker kind, project key, epic and story types, issue types, required fields, link types, size and sprint field ids, can_create, run_label |
| `idea` | 1 | `{goal, who_benefits, success, constraints}` |
| `glossary` | 1, 2 | `[{user_term, project_term}]` |
| `today` | 2 | `[{area, source_path, section_status}]` |
| `playback` | 3 | `{goal_first_playback, lenses, options, smaller_first_step, recommendation}` |
| `decisions` | 4 | `[{id, question, choice, by, why}]` |
| `assumptions` | 1, 4 | `[{id, question, default, why}]` |
| `outcome` | 4 | `{type, reason, next_action}` |
| `ticket_set_ref` | 5 | `{path, digest, revision}` |
| `readiness` | 5 | `{status: "passed"\|"open", checks, reviewer, notes}` |
| `posted` | 6 | `{issues: [{ref, issue_key, status}], read_back}` |

`record.py new_record` also seeds `existing`, `changes`, `sizing`, `sprint_plan` (other modes), `stale: []` and `approval: null`.

## Script Interfaces

Shared scripts called by this skill (full contract under discovery-record):

| Command | Purpose | stdout | Exit |
|---|---|---|---|
| `record.py init --path <f> [--run-id <id>] [--mode build]` | Create record, revision 0, step 0 | `{"revision", "step", "status": "initialized"}` | 0 |
| `record.py show --path <f>` | Print record and ticket digest | `{"record", "ticket_digest"}` | 0 |
| `record.py update --path <f> --expect-revision <n> --patch <patch.json>` | Replace named blocks, apply go-back map | `{"revision", "step", "status": "updated"\|"reverted"}` | 0 |
| `record.py advance --path <f> --expect-revision <n>` | Move to next step if required blocks are present and fresh | `{"revision", "step", "status": "advanced"}` | 0 |
| `check_record.py --path <f> [--step <n>]` | Report missing or stale required blocks | `{"ok", "issues": [{code, path, message}]}` | 0 clean, 1 otherwise |

`record.py` failures print `{"ok": false, "error": <msg>}` to stderr and exit 1.

## State Management

| Rule | Behaviour |
|---|---|
| Required blocks per step (`record.REQUIRED`) | 0 setup; 1 idea; 2 today; 3 playback; 4 decisions, outcome; 5 ticket_set_ref, readiness; 6 posted |
| Expected revision | Every `update`/`advance` must pass the current `run.revision`; otherwise "Stale revision: expected X, current Y." |
| Revision | Rises by one on every update, advance and approve |
| Go-back chain (`record.CHAIN`) | `idea -> today -> playback -> decisions -> ticket_set_ref -> readiness -> posted`; the earliest changed block stales every later one |
| Outside the chain | `run`, `setup`, `glossary`, `assumptions`, `outcome` are never staled |
| Fresh on write | A block written in a patch is removed from `stale` |
| `reverted` vs `updated` | `reverted` when a dependent that already held content was staled |
| Approval | `approval` is set to `null` on every update |
| Advance | Refused when a required block is missing, stale, or the step is already 6 |
| Side question | No record write and no advance |
| Step change | One-line status, then the next step's work in the same reply; no carry-on question and no mention of the record or its file (TALK-12, TALK-14, TALK-15) |
| Resume | The record is offered as a resume file only when the user asks to stop and come back later, its format not named (REC-5). On resume, read it first, confirm `run.step` in one line, continue; `check_record.py` shows what still needs redoing |

Note: `journey.md` lists `ticket_set_ref -> posted` only; `record.py` also stales `readiness` on a `ticket_set_ref` change (documented in `record.py` as deliberate over-invalidation, INV-11).

## Error Codes

| Code | Source | Meaning |
|---|---|---|
| `MISSING` | `check_record.py` | Required block for the step is missing or empty |
| `STALE` | `check_record.py` | Required block is present but stale |
| `STEP` | `check_record.py` | Unknown step in build mode |
| `RECORD` | `check_record.py` | Record has no `run` block |

`record.py` raises plain messages (stale revision, undocumented block, cannot advance: missing or stale, already at the final step), not codes.

## Dependencies

| Kind | Item |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md`, `references/consulting.md`, `scripts/canonical.py`, `scripts/record.py`, `scripts/check_record.py` |
| Modules | discovery-record, conversation-standards, project-grounding (via step skills), ticket-drafting, ticket-posting |
| Host capabilities | Creating a file for the record in the working folder, silently (REC-2), handed over as a resume file only on request (REC-5); a choice prompt for every choice, with a short list in the reply as the fallback (TALK-8); running Python 3.9 (optional, checklist fallback otherwise) |

## Configuration

None. The step map and invalidation map are fixed in `journey.md` and `record.py`.

## Testing Entry Points

| Kind | Entry point |
|---|---|
| Unit | `tests/scripts/test_record.py`: `InitTest`, `ExpectedRevisionTest`, `GoBackTest` (AC-7), `InvalidationMapTest`, `AdvanceTest`, `UndocumentedBlockTest`, `BuildModeUnchangedTest` |
| Unit | `tests/scripts/test_check_record.py`: `ResumeSignalTest` (AC-15), `GuardTest`, `SyncGuardTest`, `CliTest` |
| Authoring | `tests/scripts/test_authoring.py`: `TriggerHygieneTest` (AC-19), `ChecklistFallbackTest` (AC-16), `VoiceBlockTest` (AC-13) |
| Unit | `tests/scripts/test_conversation_feedback.py`: `ChoicePromptTest`, `QuestionLastTest`, `SilentRecordTest`, `KeepMovingTest` |
| Eval scenarios (`business-feedback.yml`) | `ac-68`, `ac-68b`, `ac-69`, `ac-70`, `ac-71`, `ac-72` |
| Eval scenarios (`s1.yml`) | `ac-3`, `ac-15` (resume from a resume file), `ac-24`, `ac-48`; journey-wide `ac-2`, `ac-9`, `ac-10`, `ac-47` enter through `product-discovery` but exercise other modules |
