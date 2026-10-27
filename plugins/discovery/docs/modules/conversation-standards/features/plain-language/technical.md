# Plain business words: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `shared/references/plain-language.md` | The TKT-3 deny-list (40 `term -> replacement` entries under "Deny-list") |

The parser and the matching live in `shared/scripts/check_prose.py` (tracker-checks, prose-check).

## Data Contracts

Entry format, as read by `check_prose.load_denylist`:

| Rule | Detail |
|---|---|
| Line shape | `- term -> replacement` (the leading `- ` is optional) |
| Term | Text left of `->`, stripped; must be non-empty and contain no space, otherwise the line is ignored |
| Replacement | Text right of `->`, stripped; must be non-empty |
| Other lines | Any line without `->` is ignored, so headings and prose are safe |

Matching (in `check_prose.scan`): `\b<term>\b` against the case-folded prose, after inline code spans and URLs are removed and fenced code and blockquote lines skipped.

## Script Interfaces

None: this feature is instruction-only. It is consumed by `check_prose.py --denylist`, whose default is `../references/plain-language.md` relative to the script.

## State Management

None: stateless.

## Error Codes

None of its own. Hits are reported by the prose check as `TKT3` findings.

## Dependencies

| Kind | Detail |
|---|---|
| Declared by skills (`build/skills.yml`) | `write-tickets`, `check-tickets`, `refine-ticket` import `references/plain-language.md` |
| Consumer | `shared/scripts/check_prose.py` (imported by `check-tickets` and `refine-ticket`, which both also import this file, so the default path resolves) |
| Host capability | None |

## Configuration

The file is the configuration. To add a term, add one `- term -> replacement` line with a single-word term; multi-word terms are silently skipped by the loader.

## Testing Entry Points

| File | Tests |
|---|---|
| `tests/scripts/test_tickets.py` | Loads the real file as `DENYLIST`; `CheckProseTest.test_jargon_flagged_with_plain_replacement` |

Eval scenarios (declarative, not yet run in CI): `s1.yml` `ac-43`, `ac-46`; `s1b.yml` `ac-30` (`plain-business-words`).
