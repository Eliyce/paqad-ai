# Create, update and advance the record: API

This feature has no network or HTTP API. The record is a local JSON file that the skills read and
write through one command-line script, `scripts/record.py` (`shared/scripts/record.py`, copied
into `product-discovery`, `refine-ticket`, `size-work` and `plan-sprint` at build time). The script
uses the standard library only, makes no network calls and writes only the file named by `--path`.
The record is written silently: no command output is shown to the user, and the file is handed
over as a resume file only when the user asks to stop and come back later (REC-2, REC-5, TALK-15).

## Commands

| Command | Arguments | stdout on success |
|---|---|---|
| `record.py init` | `--path <record.json>`, optional `--run-id <DR-YYYYMMDD-XXXX>`, `--mode build\|refine\|size\|plan` | `{"revision": 0, "step": 0, "status": "initialized"}` |
| `record.py show` | `--path <record.json>` | `{"record": {...}, "ticket_digest": <ticket_set_ref.digest>}` |
| `record.py update` | `--path`, `--expect-revision <int>`, `--patch <patch.json>` | `{"revision", "step", "status": "updated"\|"reverted"}` |
| `record.py advance` | `--path`, `--expect-revision <int>` | `{"revision", "step", "status": "advanced"}` |
| `record.py approve` | `--path`, `--expect-revision <int>`, `--block changes\|sprint_plan`, `--message-ref <ref>` | `{"revision", "step", "status": "approved"}` (see [approval-digests](../approval-digests/technical.md)) |

- `init` creates the record at revision 0 and step 0, minting a run id when none is given.
- `show` reads the record and prints it with the ticket set digest; it writes nothing.
- `update` replaces only the blocks named in the patch, applies the go-back stale map and sets
  `approval` to null. `reverted` means a later block that already held content was staled.
- `advance` moves to the next step only when the step's required blocks are present and not stale.

Every write (`update`, `advance`, `approve`) must pass the current `run.revision`; a mismatch is
refused with "Stale revision: expected X, current Y." Each success raises the revision by one.

## Step readiness

`check_record.py --path <record.json> [--step <n>]` is the read-only companion (owned by
[step-readiness-check](../step-readiness-check/technical.md)). It prints
`{"ok", "issues": [{code, path, message}]}` with codes `MISSING`, `STALE`, `STEP` and `RECORD`,
and is used on resume to show what still needs redoing.

## Exit codes

| Exit | When |
|---|---|
| 0 | `record.py` succeeded, or `check_record.py` found nothing to report |
| 1 | `record.py` raised `ValueError`, `OSError`, `KeyError` or `TypeError` (`{"ok": false, "error": <msg>}` on stderr), or `check_record.py` reported an issue |
| 2 | Argument usage error |
