# Post approved tickets: API

This feature has no network or HTTP API. All tracker reads and writes go through the host's own
connector; these scripts only plan the posting run and export a fallback file, and they post
nothing themselves. The feature's programmatic surface is two command-line scripts.

## plan_posting.py

```
plan_posting.py plan      --state <state.json>
plan_posting.py next      --state <state.json>
plan_posting.py claim     --state <state.json>
plan_posting.py record    --state <state.json> --operation <id> --receipt <receipt.json>
plan_posting.py reconcile --state <state.json> --operation <id> [--tracker-issues <found.json>]
```

| Argument | Meaning |
|---|---|
| `--state` | The run state file holding `ticket_set`, `setup`, `connector`, `approval`, `receipts`, `posted`. Rewritten in place by the mutating subcommands (PUB-5). |
| `--operation` | The operation id to record or reconcile. |
| `--receipt` | The receipt JSON for `record` (`{ status, result: { key } }`), where status is `created`, `uncertain`, or `not_applied`. |
| `--tracker-issues` | For `reconcile`: the tracker issues found by run label, matched against the operation's item reference. |

### Inputs

- state: `{ ticket_set: { tracker: { project_key, epic_type, story_type }, epics: [{ ref, title, body_markdown, labels, tickets: [{ ref, title, body_markdown, depends_on }] }], digest }, setup: { run_label }, connector: { actions: [..] }, approval: { digest, message_ref }, receipts, posted }`.

### Output (stdout)

The ordered operation plan from `plan` (also written back into `state.plan`):

```json
{ "ticket_digest": "...", "link_action": "createIssueLink", "links_by_hand": false,
  "depends_on_lines": [],
  "operations": [ { "id", "action", "kind", "item_ref", "arguments" } ] }
```

Operations run in a fixed order (PUB-3): epics first, then each epic's tickets parented to the
created epic, then the dependency links, then a final read-back. A child's parent and every link
target is a result reference (`{"$result": {"operation": <op id>, "path": ["key"]}}`) resolved from
the referenced create's verified receipt. The link action name is resolved from what the connector
exposes (`createJiraIssueLink` or `createIssueLink`, AC-18); when the connector advertises its
actions but exposes no link action, `links_by_hand` is true and each dependency is written into the
ticket body as a "Depends on" line instead (U-3). Both epic and story create operations carry the
`paqad-discovery` shared label plus the run label (PUB-4). `next` and `claim` return the next
operation with its arguments resolved (`claim` also marks it `in_flight`); `record` and `reconcile`
return the stored receipt or reconcile result. Exit 0 clean, 1 on error.

## export_csv.py

```
export_csv.py --ticket-set <ticket-set.json> [--out <file>] [--format csv|markdown]
```

| Argument | Meaning |
|---|---|
| `--ticket-set` | The approved ticket set to export. |
| `--out` | Optional output path inside the working folder; without it the export prints to stdout. |
| `--format` | `csv` (default) or `markdown`. `markdown` renders the same rows as a Markdown table for a host that cannot import a CSV (PUB-8). |

### Inputs

- ticket-set: `{ tracker: { epic_type, story_type }, epics: [{ ref, title, body_markdown, labels, tickets: [{ ref, title, body_markdown, labels }] }] }`.

### Output (stdout or `--out`)

A Jira importer CSV, or a Markdown table under `--format markdown`, with columns in exactly this
order: `Work type, Work item id, Summary, Description, Labels, Parent`. Every epic row comes before
its story rows, and each story's `Parent` is its epic's work item id. Labels are joined with spaces
and both epic and story rows carry their labels (PUB-4). Exit 0 clean, 1 on error.

## Other scripts this feature calls (owned elsewhere)

| Script | Role |
|---|---|
| `check_readback.py` (tracker-checks) | Compare each posted issue read back from the tracker against the approved set. |
