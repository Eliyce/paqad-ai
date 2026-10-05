# Ticket writing rules: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `shared/references/writing-rules.md` | The five rules, what the checker skips, and where the rules apply hardest |

Enforcement lives in `shared/scripts/check_prose.py` (tracker-checks, prose-check). The epic and ticket templates that cite this file (`skills/write-tickets/assets/epic-template.md`, `ticket-template.md`) belong to ticket-drafting.

## Data Contracts

None. Plain Markdown instruction text, copied to `skills/<name>/references/writing-rules.md`.

Script coverage of each rule:

| Rule | Checked by script | Finding code |
|---|---|---|
| TKT-1 | Yes, whole text | `TKT1` |
| TKT-2 | Yes, title, body sections whose heading contains "goal" or "what they need", and each `done_when` entry | `TKT2` |
| TKT-3 | Yes, whole text | `TKT3` |
| TKT-4 | No; `check_prose.py` has no sentence-length check | none |
| TKT-5 | No; judgment only | none |

## Script Interfaces

None: this feature is instruction-only.

## State Management

None: stateless.

## Error Codes

None of its own; see the prose-check finding codes above.

## Dependencies

| Kind | Detail |
|---|---|
| Declared by skills (`build/skills.yml`) | `write-tickets`, `refine-ticket` import `references/writing-rules.md` |
| Not declared | `check-tickets` runs the prose check but does not import this file; its `SKILL.md` restates the rules in its checklist |
| Other modules | conversation-standards plain-language (TKT-3 list); tracker-checks prose-check (enforcement) |

## Configuration

None.

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_tickets.py` | `CheckProseTest.test_em_dash_and_function_name_blocked_with_fixes`, `test_fixed_set_passes`, `test_quoted_code_and_url_content_not_rewritten`, `test_jargon_flagged_with_plain_replacement`, `test_single_document_scan` (AC-8) |
| `tests/scripts/test_authoring.py` | `HousePromptTest.test_no_em_or_en_dash` applies TKT-1-style dash rules to the repository's own authored files (CI-5) |
