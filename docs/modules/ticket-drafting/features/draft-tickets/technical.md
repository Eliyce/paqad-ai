# Draft the ticket set: technical

## Module Boundaries

Owned paths (module `ticket-drafting`, feature `draft-tickets`):

| Path | Role |
|---|---|
| `skills/write-tickets/SKILL.md` | Step skill instructions; no-script checklist |
| `skills/write-tickets/assets/epic-template.md` | Epic section order and rules |
| `skills/write-tickets/assets/ticket-template.md` | User-story ticket layout and its mapping to `ticket-set.json` |
| `skills/write-tickets/assets/ticket-set.schema.json` | JSON Schema (draft-07) for `ticket-set.json` |

The user-story rules come from `shared/references/user-stories.md` (owned by `conversation-standards`, imported as `references/user-stories.md`, TKT-6). The skill is a step skill: its description states it "runs when the product-discovery journey directs it; not started directly". It reads the record blocks `idea`, `today`, `playback`, `decisions` and `assumptions` and nothing else.

## Data Contracts

`ticket-set.json`, fixed by `assets/ticket-set.schema.json` (REQUIREMENTS 8.3):

```json
{
  "run_id": "DR-20261005-7K2Q",
  "revision": 0,
  "digest": "<64 hex chars>",
  "tracker": { "kind": "", "project_key": "", "epic_type": "", "story_type": "" },
  "epics": [
    {
      "ref": "E1",
      "title": "<1..80 chars>",
      "body_markdown": "",
      "labels": [],
      "tickets": [
        {
          "ref": "E1-T1",
          "title": "<1..80 chars>",
          "body_markdown": "",
          "done_when": ["<2..8 non-empty strings>"],
          "depends_on": [],
          "assignee_hint": null
        }
      ]
    }
  ]
}
```

Schema constraints: `additionalProperties: false` at every object level; `run_id` pattern `^DR-[0-9]{8}-[A-Z0-9]{4}$`; `digest` pattern `^[0-9a-f]{64}$`; epic `ref` `^E[0-9]+$`; ticket `ref` `^E[0-9]+-T[0-9]+$`; `epics` and each `tickets` have `minItems: 1`; `assignee_hint` is string or null.

Digest rule: sha256 of the canonical JSON of the whole object with `digest` removed; canonical JSON is `json.dumps` with `sort_keys=True`, `ensure_ascii=False`, `separators=(",", ":")`, `allow_nan=False` (`shared/scripts/canonical.py`).

`body_markdown` holds the rendered template sections. Epic sections (in order): Title, Goal, Why it matters, What exists today, In scope / Not in scope, How we'll know it worked, Decisions made, Open questions, Sources. Ticket layout (in order, user story, TKT-6): Implementation Target (API or UI), Module Name, Feature Name and Roadmap Reference (optional, the line omitted when not given), Epic, the As a / I want / So that block, Acceptance Criteria (bold Given / When / Then lines, And or But continuing the same bullet), Depends on ("none" when empty), What exists today, Not included, Open questions (optional), Sources (last). Every line inside a block except its last ends with two trailing spaces. The title is the `title` field and is not repeated in the body.

Field mapping (the schema is unchanged in v3.2): each acceptance criterion is one `done_when` item, its lines joined by two trailing spaces and a newline, still 2 to 8; Depends on is `depends_on`; refs stay `E<n>-T<n>`. The schema now carries a `description` on `done_when` and `depends_on` stating this.

Record block written for this file (`skills/product-discovery/assets/record-template.md`): `ticket_set_ref` = `{ "path", "digest", "revision" }`.

## Script Interfaces

None: this feature is instruction-only. The schema file states the standard library has no JSON-Schema validator; `skills/check-tickets/scripts/check_ticket_set.py` (feature `check-tickets`) hand-validates it.

## State Management

- Reads record blocks `idea`, `today`, `playback`, `decisions`, `assumptions`.
- Output is referenced by the record block `ticket_set_ref` (path, digest, revision). The skill does not import `record.py` (see `build/skills.yml`); the record write goes through the coordinator (`product-discovery`, module `idea-journey`), which imports `record.py`.
- `ticket_set_ref` sits in the build-mode dependency chain `idea -> today -> playback -> decisions -> ticket_set_ref -> readiness -> posted` (`shared/scripts/record.py` `CHAIN`, REC-4). Changing it marks `readiness` and `posted` stale; changing any earlier chain block marks `ticket_set_ref` stale.
- Step 5 requires `ticket_set_ref` and `readiness` (`record.py` `REQUIRED[5]`).

## Error Codes

None.

## Dependencies

| Kind | Dependency |
|---|---|
| Shared imports (`build/skills.yml`) | `references/voice.md`, `references/plain-language.md`, `references/writing-rules.md`, `references/user-stories.md` (module `conversation-standards`) |
| Other modules | `discovery-record` (record blocks, digest rule), `idea-journey` (directs the step, writes the record) |
| Downstream | `check-tickets` and `ticket-posting` read `ticket-set.json` |
| Host capabilities | Creating a downloadable preview file where the host can, otherwise chat only; a choice prompt for the intake questions and the permission-key confirmation (a short list in the reply as the fallback) |

## Configuration

- Deny-list: `shared/references/plain-language.md` (imported as `references/plain-language.md`).
- Writing rules: `shared/references/writing-rules.md`.
- No other configuration.

## Testing Entry Points

| Entry point | What it covers |
|---|---|
| `tests/scripts/test_authoring.py` `SkillFrontmatterTest.test_each_skill`, `VoiceBlockTest.test_each_skill_opens_with_voice_block`, `HousePromptTest.test_no_em_or_en_dash`, `TriggerHygieneTest.test_entry_and_step_descriptions` | Frontmatter, voice block, no dashes, step-skill description |
| `tests/scripts/test_tickets.py` `CheckTicketSetTest` | Exercises sets in the schema shape (indirect) |
| `tests/evals/scenarios/s1.yml` `ac-47` | Compact preview plus file, nothing posted without approval |
| `tests/scripts/test_user_stories.py` `UserStoriesReferenceTest`, `TicketTemplateTest`, `StoryStructureTest`, `BuiltSkillsTest` | The user-stories reference is imported by exactly the ticket skills and carries the rules; template labels in order; a story set passes the structure check and nine criteria fail |
| `tests/evals/scenarios/business-feedback.yml` `ac-73`, `ac-74` | Permission key confirmed first, API then UI stories; refusal of a no-value ticket |

The skill ships no script; the unit tests above check its reference, template and the shape of story sets. Eval scenarios are declarative and not run in CI until S3 (`tests/evals/scenarios/README.md`).
