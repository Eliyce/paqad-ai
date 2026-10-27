# Ticket writing rules: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `shared/references/writing-rules.md` | The five rules, the one allowed code span (a confirmed permission key), what the checker skips, and where the rules apply hardest |
| `shared/references/user-stories.md` | The single source for the user-story shape (TKT-6): the two hard filters, intake (Implementation Target, Module Name, optional Feature Name and Roadmap Reference, permission key confirmation), the line-break rule, role / I want / So that, Given/When/Then criteria, permissions in the criteria, the silent ten-row self-audit, API then UI pairing, refusal, titles and a worked example |

Enforcement lives in `shared/scripts/check_prose.py` (tracker-checks, prose-check). The epic and ticket templates that cite this file (`skills/write-tickets/assets/epic-template.md`, `ticket-template.md`) belong to ticket-drafting.

## Data Contracts

None. Plain Markdown instruction text, copied to `skills/<name>/references/writing-rules.md`.

Script coverage of each rule:

| Rule | Checked by script | Finding code |
|---|---|---|
| TKT-1 | Yes, whole text | `TKT1` |
| TKT-2 | Yes, title, body sections whose heading contains "goal" or "what they need", every user story line (As a, I want, So that) anywhere in the body, and each `done_when` entry; a confirmed permission key in inline code is allowed | `TKT2` |
| TKT-3 | Yes, whole text | `TKT3` |
| TKT-4 | No; `check_prose.py` has no sentence-length check | none |
| TKT-5 | No; judgment only | none |
| TKT-6 | Partly: `check_ticket_set.py` enforces 2 to 8 criteria; the story shape is a judgment check (review-checklist item 6) | `DONE_WHEN` |

## Script Interfaces

None: this feature is instruction-only.

## State Management

None: stateless.

## Error Codes

None of its own; see the prose-check finding codes above.

## Dependencies

| Kind | Detail |
|---|---|
| Declared by skills (`build/skills.yml`) | `write-tickets`, `refine-ticket` import `references/writing-rules.md`; `write-tickets` and `check-tickets` import `references/user-stories.md` |
| Not declared | `check-tickets` runs the prose check but does not import this file; its `SKILL.md` restates the rules in its checklist |
| Other modules | conversation-standards plain-language (TKT-3 list); tracker-checks prose-check (enforcement) |

## Configuration

None.

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_tickets.py` | `CheckProseTest.test_em_dash_and_function_name_blocked_with_fixes`, `test_fixed_set_passes`, `test_quoted_code_and_url_content_not_rewritten`, `test_jargon_flagged_with_plain_replacement`, `test_single_document_scan` (AC-8) |
| `tests/scripts/test_user_stories.py` | `UserStoriesReferenceTest` (declared by exactly the ticket skills, carries the rules, short or has contents), `TicketTemplateTest`, `StoryProseTest` (AC-75), `StoryStructureTest`, `BuiltSkillsTest` |
| `tests/scripts/test_authoring.py` | `HousePromptTest.test_no_em_or_en_dash` applies TKT-1-style dash rules to the repository's own authored files (CI-5) |
