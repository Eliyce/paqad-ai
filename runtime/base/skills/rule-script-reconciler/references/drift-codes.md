# RS-\* drift codes

The reconciler (`src/rule-scripts/reconciler.ts`) emits these into `.paqad/scripts/rules/.cache/drift.json`. They share the `RS-` prefix registered in the base `finding-normalizer` vocabulary.

| Code               | Trigger                                                                                                                  | Resolution prompt                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `RS-RULE-ADDED`    | A markdown bullet under `docs/instructions/rules/**` has no `<!-- @rule -->` marker, or a marked rule is not in the map. | `analyze rules` (mints the id, classifies, drafts scripts).                      |
| `RS-RULE-EDITED`   | A marker's rule text hash differs from the map entry.                                                                    | `edit rule RL-<id> to "<text>"` (preserves id, regenerates that rule's scripts). |
| `RS-RULE-REMOVED`  | A map entry's marker is gone from the markdown.                                                                          | `remove rule RL-<id>` (archives the entry, prunes scripts next regen).           |
| `RS-SCRIPT-STALE`  | A rule was edited but its registered scripts were not regenerated.                                                       | `regenerate scripts for rule RL-<id>`.                                           |
| `RS-FIXTURE-FAIL`  | A registered script no longer passes its own `__fixtures__` (e.g. after a dependency upgrade).                           | `regenerate scripts for rule RL-<id>`.                                           |
| `RS-CACHE-INVALID` | A findings report exists but its `rule_files_hash` no longer reconciles.                                                 | None — the runner recomputes on its next run. Informational only.                |

## Blocking

Every code **except** `RS-CACHE-INVALID` sets `blocked: true`. At `feature-development` planning entry this gates the workflow per the project's `escalation.rule_scripts_stale` setting (`stop` | `ask` | `warn`).

## Resolution routing

Resolutions never edit `rule-script-map.yml` directly:

- additions / re-classification → `rule-analyzer`
- text edits / removals / downgrades → `rule-editor`
- script regeneration → `rule-script-generator`

All three write the map through `src/rule-scripts/apply.ts` (the single writer).
