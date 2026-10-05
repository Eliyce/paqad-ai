# Prose check: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `shared/scripts/check_prose.py` | `load_denylist`, `finding`, `code_word_hit`, `scan`, `body_sections`, `lint_item`, `lint_ticket_set`, `main` |

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
| TKT-2 scope | Title, body sections whose heading (Markdown `#` or a bold-only line) contains `goal` or `what they need` (case-insensitive), and every `done_when` entry. Checked on the raw line, so backtick code and URLs that look like paths are reported |
| TKT-2 order | First match wins: backtick, file path or dotted file name, HTTP verb (uppercase), SQL keyword (uppercase) or database term, library name, function call, camelCase, snake_case |
| TKT-3 | `\b<term>\b` on case-folded prose |

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
| Library names | `LIBRARY` regex: react, redux, django, flask, numpy, pandas, express, spring, hibernate, kubernetes, docker, postgres, postgresql, mysql, mongodb, redis, kafka, webpack, babel, typescript, graphql, sqlalchemy |

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_tickets.py` | `CheckProseTest.test_em_dash_and_function_name_blocked_with_fixes`, `test_fixed_set_passes`, `test_quoted_code_and_url_content_not_rewritten`, `test_jargon_flagged_with_plain_replacement`, `test_single_document_scan` (AC-8, TKT-3) |

Eval scenario: `s1b.yml` `ac-30` (`plain-business-words`, declarative).
