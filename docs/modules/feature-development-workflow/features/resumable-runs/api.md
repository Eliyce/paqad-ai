# Resumable Runs — API View

> Module: **Feature Development Workflow** (`feature-development-workflow`) · Layer: `agent-workflows` · Feature slug: `resumable-runs`

Resumable runs have no HTTP surface. A paused feature-development change is picked up again with one CLI verb. The stages it resumes into are read from paqad's policy plus the team files in `.paqad/configs/feature-development/`, shown in the generated view at `docs/instructions/workflows/feature-development.yaml` (see the conditional-steps API view for how that view is rebuilt).

## CLI: `paqad-ai resume --feature <ref>`

Reactivates a paused change.

| Flag | Meaning |
|---|---|
| `--feature <ref>` | Required. The paused change: its ULID, issue, slug or bundle folder name. |
| `--session <id>` | Session id to resume under. Defaults to `SE_SESSION`, then `CLAUDE_SESSION_ID`, then the shared ledger-session cache. |
| `--project-root <path>` | Project root. Default: the current directory. |

Behaviour:

- On success prints `**▸ paqad** · resumed <feature>` and then `{"resumed":true,"feature":"<feature>"}`.
- When no recorded change matches the ref, prints `could not resume "<ref>" — no recorded change matches that ref.` on stderr and exits 1.

## TypeScript

```ts
// src/feature-evidence/stage-ledger.ts
export function resumeFeatureByRef(projectRoot: string, sessionId: string, ref: string, now?: () => Date): string | null;
```
