# Decision packet contract

The `decision` skill authors the small, human-facing decision record described by
the **Decision Pause Contract** (shipped inline in the framework bootstrap,
`AGENT-BOOTSTRAP.md`). It is deliberately distinct from the rich `DecisionPacket`
that the automated intake / reuse pipeline (`DecisionStore`,
`src/planning/decision-packet.ts`) mints and consumes — this one is a readable
trail committed alongside the PR it justifies.

## Lifecycle

1. **Create** — `create.mjs` mints a collision-free `D-<ULID>` id and writes the
   pending packet to `.paqad/decisions/pending/D-<ULID>.json`.
2. **Present** — surface the options to the user via the host's interactive UI
   (on Claude Code, the `AskUserQuestion` tray).
3. **Resolve** — `resolve.mjs` records the chosen option and rationale, moves the
   packet to `.paqad/decisions/resolved/D-<ULID>.json`, and stamps `resolved_at`.
4. **Commit** — stage the resolved packet with the change it justifies (delivery
   workflow), so a reviewer and future `git blame` can see _why_.

## Pending shape

```json
{
  "id": "D-01J9Z3K7QW8X…",
  "category": "workflow-or-tool",
  "title": "Where should the decision-creation script live?",
  "context": "The issue defers this choice …",
  "options": [
    { "option_key": "standalone", "label": "Standalone scripts/ helper" },
    { "option_key": "skill", "label": "Skill-bundled script" }
  ],
  "recommendation": "standalone",
  "created_at": "2026-07-01T20:00:00.000Z",
  "status": "pending"
}
```

## Resolved shape

The resolved packet is the pending packet plus:

```json
{
  "status": "resolved",
  "chosen": "skill",
  "rationale": "Team chose the skill-bundled route.",
  "resolved_at": "2026-07-01T20:05:00.000Z"
}
```

## Rules

- **Never hand-write the id.** `create.mjs` mints `D-<ULID>`; a sequential
  `D-{N}` is rejected. Two developers on parallel branches must never collide.
- **At least two options**, each with a unique non-empty `option_key` and
  `label`. A `recommendation`, when present, must reference one of them.
- **`chosen` must reference an `option_key`** of the packet being resolved.
- **Never hand-edit the JSON, the timestamps, or the pending/resolved move** —
  drive every transition through the scripts, exactly as `paqad-ai stage`
  drives the stage-evidence ledger.
