# S1 intake

verified: 2026-11-01

Fill every field from the spec, the ticket, the justification and the docs, then run `paqad-ai agent intake <name> intake.yaml`.

| Field              | What it holds                                                       |
| ------------------ | ------------------------------------------------------------------- |
| `job`              | one sentence of the work                                            |
| `delegation_brief` | what the caller must hand over                                      |
| `report`           | `template` and `max_tokens`                                         |
| `tools`            | the smallest tool list                                              |
| `model_tier`       | `fast` or `reasoning`                                               |
| `effort`           | `low`, `medium`, `high`, `xhigh` or `inherit`                       |
| `stopping`         | `max_turns`, `done_when`, `when_blocked`                            |
| `memory`           | `none` or `candidate`                                               |
| `isolation`        | `none` or `worktree`                                                |
| `parallel`         | true when pieces run at once                                        |
| `cache_ttl`        | `5m` or `1h`                                                        |
| `class`            | `explorer`, `reviewer`, `builder`, `verifier` or `specialist`       |
| `invocation`       | `auto` (picked by its description) or `dispatched` (called by name) |
| `pattern`          | the workflow pattern, `single-call` to `autonomous-loop`            |

A business field nothing answers goes to the owner: `paqad-ai agent intake <name> --gap <field> --question "<text>" --option <a> --option <b> --recommend <a>`.
