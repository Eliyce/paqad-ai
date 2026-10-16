# Get the project documents: API

This feature has no network or HTTP API. Its programmatic surface is one read-only command-line
script, `shared/scripts/check_onboarded.py`, copied at build time into `get-connected`,
`ask-project` and `ground-in-project` as `scripts/check_onboarded.py`. The script carries no
docstring (RL-d091), so this page is its contract (RL-320e). Choosing the repository is
instructions only, in `references/connect-repository.md`; no script lists repositories.

## check_onboarded.py

```
check_onboarded.py [--root <repo-root>]
```

| Argument | Meaning |
|---|---|
| `--root` | The repository root to check. Optional; defaults to the current working folder. |

Any other argument is an `argparse` usage error: usage on stderr, nothing on stdout, exit 2.

### Inputs

No JSON input. The script reads the file tree under `--root` only. It is read-only, writes
nothing and makes no network call.

- The modules list, `docs/instructions/registries/modules.md`.
- The area summaries, `docs/modules/<area>/index/summary.md` for each sub-folder of
  `docs/modules/` whose name does not start with a dot.

A file that is not a regular file, is empty or whitespace-only, or cannot be read or decoded as
UTF-8 counts as missing. A `docs/modules` folder that is missing or cannot be listed has no areas.

### Output (stdout)

Exactly one JSON object, keys in this order.

Ready (the modules list and at least one area summary), exit 0:

```json
{"ok": true, "state": "ready", "unknown_areas": []}
```

Partly ready (at least one area summary, no modules list), exit 0:

```json
{"ok": true, "state": "partly-ready", "message": "This project's list of areas is missing, so I'm working from the area summaries it has. Areas without a summary are shown as unknown.", "unknown_areas": ["billing"]}
```

Not set up (no area summary, whatever else exists), exit 1:

```json
{"ok": false, "state": "not-set-up", "message": "This repository isn't set up for this yet. Ask your engineering team to onboard it with paqad, then come back."}
```

`unknown_areas` lists the areas whose summary is missing, sorted by name; it can be non-empty in
the ready state too. Callers say `message` once and name the unknown areas in plain words as not
documented, never as missing features (GRD-8, `connect-repository.md`).

### Exit codes

| Exit | Meaning | What the skill does |
|---|---|---|
| 0 | Ready or partly ready | Read by the instructions as the project-docs level (ready) or the docs-and-code level (partly ready). Continue; on partly ready, say the message once and rank areas with `find_related.py --modules-dir docs/modules` |
| 1 | Not set up | Read by the instructions as the code-only level, not a stop: answer from the code by names with the "paqad, from code only" source line; the exact message appears only as the optional at-most-once nudge. The only stop is nothing readable at all (GRD-12) |
| 2 | Usage error | Not a repository state: the call itself was wrong (usage on stderr, nothing on stdout) |

The script is byte-identical (GM-8); only the instructions' reading of its three states changed, to the three evidence levels in `references/evidence-levels.md`.

### Change from the earlier contract

The earlier script printed `{"ok": true}` or `{"ok": false, "message": ...}` and refused any
repository missing the modules list. The output now always carries `state`, and a passing result
carries `unknown_areas`. The one change in exit code: a repository with area summaries but no
modules list now exits 0 (partly ready) instead of 1. Every other tree keeps its exit code, and
the not set up message is unchanged byte for byte.

### Python functions

For callers inside the plugin (`find_related.py` imports the module):

| Function | Returns |
|---|---|
| `area_summaries(modules_dir)` | `[(area, text), ...]` sorted by area, `text` stripped, `""` when missing or unreadable |
| `onboarded_state(root)` | `{"state", "summarised_areas", "unknown_areas"}` |
| `is_onboarded(root)` | `True` only when the state is `ready` |
| `result_payload(result)` | The stdout object above for an `onboarded_state` result |
| `main(argv=None)` | Prints the payload and returns the exit code |
