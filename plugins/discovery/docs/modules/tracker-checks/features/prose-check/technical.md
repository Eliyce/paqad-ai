# Prose check: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `shared/scripts/check_prose.py` | `load_denylist`, `finding`, `code_word_hit`, `scan`, `body_sections`, `code_scoped_lines`, `lint_item`, `lint_ticket_set`, `main` |

The deny-list data lives in `shared/references/plain-language.md` (conversation-standards).

## Data Contracts

Input, one of:

| Mode | Input |
|---|---|
| `--ticket-set` | Canonical ticket set JSON (`skills/write-tickets/assets/ticket-set.schema.json`): `epics[].title`, `epics[].body_markdown`, `epics[].tickets[].title`, `.body_markdown`, `.done_when[]` |
| `--path` | Any text file, scanned for TKT-1 and TKT-3 only |

Output (stdout, indented JSON):

```json
{"ok": false, "issues": [{"code": "TKT2", "path": "tickets[E1-T1]:title:1", "message": "A function or method call appears in a plain-language field.", "suggestion": "Describe what it does in plain words."}]}
```

`path` forms: `epics[<ref>]:title:<line>`, `epics[<ref>]:body:<line>`, `tickets[<ref>]:title:<line>`, `tickets[<ref>]:body:<line>`, `tickets[<ref>]:done_when[<i>]:<line>`, or `<file>:<line>` in `--path` mode.

Scanning rules:

| Rule | Behaviour |
|---|---|
| Skips | Lines inside fenced blocks (three or more backticks or tildes), lines starting with `>`; for TKT-1 and TKT-3 also inline code spans and `http(s)://` URLs |
| TKT-2 scope | Title, body sections whose heading (Markdown `#` or a bold-only line) contains `goal` or `what they need` (case-insensitive), every user story line anywhere in the body (`STORY_LINE`: a line starting `**As a**`, `**As an**`, `**I want**` or `**So that**`, case-insensitive), and every `done_when` entry. Checked on the raw line, so backtick code and URLs that look like paths are reported |
| Permission key | `code_word_hit` first removes every `PERMISSION_KEY` span (an inline code span `can <verb> <noun>`, lowercase words, two to four after `can`) from the line, then runs the TKT-2 order. A confirmed key alone is clean; any other backtick span left on the line is still `TKT2` |
| TKT-2 order | First match wins: backtick, file path or dotted file name, HTTP verb (uppercase), SQL keyword (uppercase) or database term, library name, function call, camelCase, snake_case |
| TKT-3 | `\b<term>\b` on case-folded prose |

Design notes (the reasoning behind the v3.2 changes, kept here rather than in code comments):

- Story lines carry TKT-2 wherever they sit. A user-story ticket (TKT-6) puts the As a, I want and So that block at the top of the body under no heading, so the heading scope alone would miss it. Matching the line itself keeps the rule on the fields a developer and tester read first, whatever the layout.
- `code_scoped_lines(body)` returns the ordered, de-duplicated `(number, line)` pairs that carry TKT-2: the lines under a scoped heading plus every story line. A story line that also sits under a scoped heading (an older ticket with "What they need and why") is scanned once, so it yields one finding, not two. `lint_item` runs `scan(..., check_code=True)` over these pairs and keeps only `TKT2` findings; TKT-1 and TKT-3 still come from the full-body scan.
- The permission key is the one allowed code span. TKT-6 writes a gated capability's confirmed key in inline code inside the acceptance criteria; it is a business name the user agreed, not code. It is removed before the backtick test rather than whitelisted after, so the rest of the line is still judged and a second code span beside the key is still flagged. The pattern is narrow (`can` plus lowercase words) so ordinary code spans never slip through.
- Lines under other headings (What exists today, Sources) stay outside TKT-2, so quoted evidence there is never reported.

## Script Interfaces

`check_prose.py (--ticket-set <ticket-set.json> | --path <file.md>) [--denylist <plain-language.md>]`

| Arg | Required | Meaning |
|---|---|---|
| `--ticket-set` / `--path` | one of them | Mutually exclusive input |
| `--denylist` | no | Defaults to `../references/plain-language.md` relative to the script |

| Exit | When |
|---|---|
| 0 | No findings (`"ok": true`) |
| 1 | Any finding |
| 1 | `ValueError`, `OSError`, `KeyError` or `TypeError` when run as a script: `{"ok": false, "error": "<message>"}` on stderr |

Read-only.

## State Management

None: stateless.

## Error Codes

| Code | Meaning |
|---|---|
| `TKT1` | Em or en dash used as a dash |
| `TKT2` | Code word in a plain-language field (message names the kind and, where available, the token) |
| `TKT3` | Deny-list jargon; suggestion gives the plain replacement |

## Dependencies

| Kind | Detail |
|---|---|
| Shared imports | `canonical.py` (`canonical.load`), from discovery-record |
| Declared by skills (`build/skills.yml`) | `check-tickets`, `refine-ticket` import `scripts/check_prose.py`, `scripts/canonical.py` and `references/plain-language.md` |
| Python | Standard library only: `argparse`, `json`, `re`, `sys`, `pathlib` |
| Host capability | A tool that runs scripts; otherwise each skill's "If the checks cannot run" checklist applies the same rules by hand (PLG-6) |

## Configuration

| Item | Where |
|---|---|
| Deny-list | `shared/references/plain-language.md` (only single-word terms are loaded) |
| Scoped headings | `CODE_SCOPED_HEADINGS = ("goal", "what they need")` |
| Story lines | `STORY_LINE = ^\s*\*\*(?:As an?\|I want\|So that)\*\*` (case-insensitive) |
| Allowed code span | `PERMISSION_KEY` = an inline code span `can [a-z]+( [a-z]+){1,3}` |
| Library names | `LIBRARY` regex: react, redux, django, flask, numpy, pandas, express, spring, hibernate, kubernetes, docker, postgres, postgresql, mysql, mongodb, redis, kafka, webpack, babel, typescript, graphql, sqlalchemy |

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_tickets.py` | `CheckProseTest.test_em_dash_and_function_name_blocked_with_fixes`, `test_fixed_set_passes`, `test_quoted_code_and_url_content_not_rewritten`, `test_jargon_flagged_with_plain_replacement`, `test_single_document_scan` (AC-8, TKT-3) |
| `tests/scripts/test_user_stories.py` | `StoryProseTest.test_clean_story_set_passes`, `test_code_in_a_criterion_is_flagged`, `test_other_code_beside_a_permission_key_is_flagged`, `test_code_on_an_i_want_line_is_flagged_at_that_line`, `test_code_under_what_exists_today_is_not_tkt2`, `test_story_under_a_scoped_heading_is_flagged_once` (AC-75, TKT-2) |

Eval scenario: `s1b.yml` `ac-30` (`plain-business-words`, declarative).
