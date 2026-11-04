# Hook payload fixtures

These are the host stdin payloads paqad's lifecycle hooks parse, one file per event.
The unit tests in `tests/unit/hooks/host-aware-hooks.test.ts` run the real hook
scripts (and the shared `edit-targets` extractor) against them so a payload-shape
regression fails loudly.

## Provenance (issue #566, INV-3)

The `claude/` fixtures are the Claude Code payload shapes paqad already handled. The
`codex/` fixtures are **derived from Codex CLI's documented hook schema** (the standard
stdin fields — `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`,
`permission_mode`, `turn_id` — plus each event's extras), verified against the Codex
docs on 2026-09-21. They are **not** a live capture: Codex was not installed in the
build environment where this landed. When Codex is available, re-capture with a
throwaway logging hook and reconcile any field-shape differences here. The
`edit-targets` extractor scans every string value of `tool_input`, so it is robust to
the exact field that carries the `apply_patch` text.

## SubagentStop fixtures (issue #567)

`claude/subagent-stop.json` and `codex/subagent-stop.json` are the `SubagentStop` payloads
the stage-isolation completion hook parses. They too are **derived from the current
documented hook schema** (verified against the Claude Code and Codex hook docs on
2026-09-21), not a live capture: this build environment has no live Claude Code / Codex
subagent host, exactly as Codex was unavailable for the #566 fixtures. The fields exercised
are the documented common ones plus each host's subagent extras (`agent_id`, `agent_type`,
and the transcript pointer — Claude `transcript_path`, Codex `agent_transcript_path`).
Neither payload carries a `usage` object, because usage on `SubagentStop` is undocumented on
both hosts today; the recorder therefore estimates tokens from the transcript and records the
row as inexact (`exact: false`). When a host surfaces exact usage, add it here and re-verify.

## Live captures of the stage agent report

`claude/subagent-handback.json`, `claude/subagent-stop.json` and `claude/subagent-stop-text.json`
were captured live from Claude Code 2.1.302 on 4 November 2026 with
`node scripts/capture-hook-fixtures.mjs --out tests/fixtures/hooks/claude`. The script makes a
throwaway project, installs one logging hook and one stage agent, runs `claude -p` once in `auto`
and once in `default` permission mode, and replaces the throwaway paths with `/capture/...`.
Re-run it on each host version bump, because the fields below decide where the report comes from.

| Fixture | Permission mode | Where the report is |
| --- | --- | --- |
| `subagent-handback.json` | `auto` | `tool_input.message` of the `SubagentHandback` PreToolUse |
| `subagent-stop.json` | `auto` | nowhere: `last_assistant_message` is undefined |
| `subagent-stop-text.json` | `default` | `last_assistant_message` |

`SubagentHandback` exists only in `auto` permission mode on 2.1.302. In every other mode a stage
agent ends in plain text and the SubagentStop payload carries the report.
