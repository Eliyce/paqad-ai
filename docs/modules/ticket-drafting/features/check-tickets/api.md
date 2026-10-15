# Check the ticket set: API

This feature has no network or HTTP API. It is the `check-tickets` step skill, run at step 5 after
drafting, only when the `product-discovery` journey directs it. It reads `ticket-set.json` and
writes the `readiness` block `{status: "passed"|"open", checks, reviewer, notes}` through the
coordinator. The duplicate search reads the tracker through the host's connector only.

## Scripts

| Script | Usage | stdout | Exit |
|---|---|---|---|
| `scripts/check_prose.py` | `--ticket-set <ticket-set.json>` (or `--path <file.md>`), optional `--denylist <plain-language.md>` | `{"ok", "issues": [{"code", "path", "message", "suggestion"}]}` | 0 clean; 1 on any finding or error |
| `scripts/check_ticket_set.py` | `--ticket-set <ticket-set.json> [--schema <ticket-set.schema.json>]` | `{"ok", "issues"}` | 0 clean; 1 on any issue or load error |

Both are read-only, standard library only, with no network. Errors print
`{"ok": false, "error": ...}` to stderr.

## Finding codes

| Code | Script | Meaning |
|---|---|---|
| `TKT1`, `TKT2`, `TKT3` | `check_prose.py` | Dash, code word (a confirmed permission key is allowed; story lines are in scope), deny-list jargon |
| `SCHEMA`, `STALE_DIGEST` | `check_ticket_set.py` | Shape error; stored digest does not match |
| `EMPTY_EPIC`, `TWO_EPICS` | `check_ticket_set.py` | An epic with no tickets; a ticket under two epics |
| `DONE_WHEN` | `check_ticket_set.py` | Acceptance criteria not 2 to 8 |
| `DUPLICATE_TITLE`, `DANGLING_DEPENDENCY`, `DEPENDENCY_CYCLE` | `check_ticket_set.py` | Repeated title; dependency pointing nowhere; dependency loop |
