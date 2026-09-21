---
'paqad-ai': minor
---

feat(#567): run each feature-development stage in a fresh subagent, with the evidence bundle as shared memory

Stage isolation is core-engine behavior for Claude Code and Codex — there is no config knob.
On the graduated and full lanes, each mandatory feature-development stage runs in its own host
subagent seeded with the paqad contract, the previous pillar artifact, and its stage
instructions; the main chat stays a lean orchestrator that routes, narrates, asks the
decision-pause questions, and speaks the receipt. Nothing is compacted because nothing
accumulates — later stages no longer re-carry earlier stages' history, so input tokens drop on
every graduated and full-lane change. The fast lane and non-subagent hosts run the stages in a
single context, unchanged.

Install and update always render six stage agents per host at user scope (never into a project
directory), a record-only `SubagentStop` hook appends a per-bundle `context-efficiency.jsonl`
stream, and the in-flight fork guard refuses to mint a third bundle on one branch. Every stage
records under the orchestrator's session id, so the bundle keeps one identity. paqad's Node code
still calls no LLM; the host's subagent runs the stage.
