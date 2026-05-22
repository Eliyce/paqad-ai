# Context Budget Heuristics

Per-artifact token estimates used by the planner. Numbers are conservative upper bounds — better to recommend compaction earlier than to discover starvation mid-implementation.

## Per-line token weights

| Artifact type                       | Tokens / line | Notes                                  |
| ----------------------------------- | ------------- | -------------------------------------- |
| Spec markdown (`.paqad/specs/*.md`) | 3.0           | Dense prose with structured fields.    |
| Acceptance criteria block           | 2.5           | Given/When/Then is moderately verbose. |
| Test plan markdown                  | 2.0           | Tables compress well.                  |
| Module docs (`docs/modules/**`)     | 2.5           | Mixed prose and registries.            |
| Source code (TS/JS/Python/Go)       | 1.5           | Short identifier-heavy lines.          |
| Source code (Java/C#/Verbose)       | 1.8           | Heavier signatures.                    |
| JSON / YAML                         | 1.2           | Highly structured, low entropy.        |
| Test file                           | 1.7           | Identifiers + assertion strings.       |

When the artifact type is unknown, use 2.0 tokens/line as a default.

## Headroom thresholds

Compute `available_tokens = model_context_window - committed_tokens`. Then:

- **Green** when `estimate <= 0.40 * available_tokens` — proceed.
- **Yellow** when `0.40 * available_tokens < estimate <= 0.65 * available_tokens` — proceed but warn.
- **Amber** when `0.65 * available_tokens < estimate <= 0.85 * available_tokens` — recommend compaction of supporting context.
- **Red** when `estimate > 0.85 * available_tokens` — recommend compaction or splitting before any implementation begins.

## Compaction recommendations

When an artifact must be evicted to fit the budget, prefer (in this order):

1. Old session history older than 2 turns
2. Stack documentation indexes (load on demand)
3. Capability skill references not active for the lane
4. Module docs for modules outside `affected_modules`
5. Verbose canonical docs that have summary indexes available

Never evict the active spec, the rules constitution, or the project profile.
