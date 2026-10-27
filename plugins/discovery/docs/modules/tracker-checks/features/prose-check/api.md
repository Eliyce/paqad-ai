# Prose check: API

This feature has no network or HTTP API. Its programmatic surface is one command-line script. It
reads JSON and prints JSON; it changes nothing.

## check_prose.py

```
check_prose.py (--ticket-set <ticket-set.json> | --path <file>) [--denylist <denylist.txt>]
```

| Argument | Meaning |
|---|---|
| `--ticket-set` | A canonical ticket set; each ticket's scoped fields are linted. |
| `--path` | A single file to scan instead of a ticket set. |
| `--denylist` | Override the jargon deny-list; defaults to the shared `plain-language.md` list. |

`--ticket-set` and `--path` are mutually exclusive, and one is required.

### Output (stdout)

A JSON result with the findings, each naming the ticket or line, the offending text, the rule
(dash, code word, or deny-list jargon) and a suggested fix. Quotes, code blocks and URLs are
skipped so quoted evidence is never rewritten. Exit code is 0 when clean and non-zero when a
finding exists.
