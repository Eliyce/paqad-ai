# Plan a sprint: API

This feature has no network or HTTP API. All tracker reads and writes go through the host's own
connector. The feature's own programmatic surface is one read-only command-line script with two
subcommands; it writes nothing outside stdout.

## fit_sprint.py

```
fit_sprint.py plan --sprint-field <id> --candidates <candidates.json>
                   --history <last-three-sprints.json> [--target-sprint <sprint>]
fit_sprint.py apply --plan <plan.json> --expect-digest <d> [--tracker-state <state.json>]
```

| Argument | Meaning |
|---|---|
| `--sprint-field` | The tracker field id that carries the sprint. |
| `--candidates` | The candidate tickets and known sprints (see shape below). |
| `--history` | The last three completed sprints, used to derive capacity (SPR-2). |
| `--target-sprint` | Optional. Pin a specific future sprint instead of the first one. |
| `--plan` | For `apply`: the approved plan produced by `plan`. |
| `--expect-digest` | For `apply`: the digest the approval is bound to; a mismatch refuses the apply. |
| `--tracker-state` | Optional. Maps a ticket ref to the sprint the host set, so apply can read each chosen ticket back. |

### Inputs

- candidates: `{ "sprints": [{ id, state: "future"|.., settable }], "candidates": [{ ref, priority, size, checks_pass, dependencies: [{ ref, done, in_sprint }] }] }`.
- history: `{ "sprints": [{ id, delivered }] }` (last three).

### Output (stdout)

`plan`:

```json
{ "ok": true, "sprint", "capacity": { "value", "derived_from": [{ "sprint", "count" }] },
  "goal", "chosen": [refs], "stretch": [refs], "left_out": [{ "ref", "reason" }],
  "total", "risks": [..], "not_ready": [{ "ref", "needs" }], "by_hand": false, "digest" }
```

The tickets selected within capacity are returned under the `chosen` key (in priority order), with
`stretch` and `left_out` alongside. The plan carries a canonical `digest` so `apply` can bind to it;
`plan_digest` excludes only the `digest` key when hashing (INV-4). When no future sprint exists the
plan reports it and creates nothing (AC-41); when the sprint field cannot be set `by_hand` is true
(U-14).

`apply`:

```json
{ "ok": true, "applied": [refs], "operations": [{ "op": "set_sprint_field", "ref", "sprint" }],
  "read_back": { "status", "confirmed": [..], "missing": [..] } }
```

`apply` recomputes the plan digest and refuses on a mismatch, then emits only sprint-field sets on
the chosen tickets (SPR-6, SPR-7). With no `--tracker-state` the read-back is a clean skip (status
`skipped`), never a spurious mismatch (INV-3), and the apply still succeeds. Exit 0 on a clean plan
or apply, 1 on no future sprint, a digest mismatch, or an error.
