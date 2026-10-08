# Check documents and tracker are ready: API

This feature has no network or HTTP API. It sets up the tracker connection and checks the
project is paqad-onboarded, but every tracker read and write goes through the host's own
connector; the plugin ships no integration code of its own (D-4, PLG-2). The feature's own
programmatic surface is one read-only command-line script that answers the onboarded check.

## check_onboarded.py

```
check_onboarded.py [--root <repo-root>]
```

| Argument | Meaning |
|---|---|
| `--root` | The repository root to check. Optional; defaults to the current working folder. |

### Inputs

No JSON input. The script reads the file tree under `--root` only. It is read-only and writes
nothing. The repository counts as onboarded (GRD-1) only when both of these exist:

- `docs/instructions/registries/modules.md`
- at least one `docs/modules/<module>/index/summary.md`

### Output (stdout)

```json
{ "ok": true }
```

On a failed check it prints the onboarded stop message instead:

```json
{ "ok": false, "message": "This repository isn't set up for this yet. Ask your engineering team to onboard it with paqad, then come back." }
```

Exit 0 when the repository is onboarded, 1 when either GRD-1 path is missing. When it fails the
feature stops at step 0 with that exact message and drafts nothing.
