# Codebase-health verbs

verified: 2026-11-03

The CLI verbs this skill runs. Detection comes only from them.

| Verb                     | Mode        | Writes                                            |
| ------------------------ | ----------- | ------------------------------------------------- |
| `paqad-ai health run`    | audit       | `docs/health/<ts>.md` and `docs/health/<ts>.json` |
| `paqad-ai health retest` | Retest mode | `docs/health/<orig-ts>-retest-<ts>.{md,json}`     |

`finding-normalizer` carries the `HL-` finding vocabulary.
