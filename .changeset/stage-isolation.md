---
'paqad-ai': minor
---

feat(#567): run each feature-development stage in a fresh subagent, with the evidence bundle as shared memory

Adds opt-in stage isolation for Claude Code and Codex. When the new `stage_isolation` flag
is on, each mandatory feature-development stage runs in its own host subagent seeded with
the paqad contract, the previous pillar artifact, and its stage instructions; the main chat
stays a lean orchestrator that routes, narrates, asks the decision-pause questions, and
speaks the receipt. Nothing is compacted because nothing accumulates — later stages no
longer re-carry earlier stages' history, so input tokens drop on every graduated and
full-lane change.

The flag is a team-floored enum defaulting to `off`, so every existing project is
byte-identical until it opts in: no `SubagentStop` hook is wired and no stage-agent files
are written while it is off. When on, install and update render six stage agents per host
at user scope (never into a project directory), a record-only `SubagentStop` hook appends a
new per-bundle `context-efficiency.jsonl` stream, and the receipt gains one `context:` line.
Every stage records under the orchestrator's session id, so the bundle keeps one identity.
paqad's Node code still calls no LLM; the host's subagent runs the stage.
