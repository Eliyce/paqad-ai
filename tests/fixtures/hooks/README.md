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

| Fixture                   | Permission mode | Where the report is                                       |
| ------------------------- | --------------- | --------------------------------------------------------- |
| `subagent-handback.json`  | `auto`          | `tool_input.message` of the `SubagentHandback` PreToolUse |
| `subagent-stop.json`      | `auto`          | nowhere: `last_assistant_message` is undefined            |
| `subagent-stop-text.json` | `default`       | `last_assistant_message`                                  |

`SubagentHandback` exists only in `auto` permission mode on 2.1.302. In every other mode a stage
agent ends in plain text and the SubagentStop payload carries the report.

## Failure policy on the plugin route

Measured live on 2.1.302 on 4 November 2026 with a throwaway plugin (`--plugin-dir`) whose
`hooks.json` carries `onFailure: "block"` and `timeout: 10`. Claude Code loads the file with the
extra keys and runs both hooks, and it honours `onFailure`: a hook that exits 1 blocked the tool
call. A cold `capability-gate.mjs pre-mutation` run took about 0.2 seconds, well inside 10 seconds.

## How much text reaches an agent

Measured live on 2.1.302 on 4 November 2026 with `node scripts/capture-hook-fixtures.mjs --probe`,
which sends a tail canary and asks the agent what arrived:

| Channel                           | Size                         | What arrived                         |
| --------------------------------- | ---------------------------- | ------------------------------------ |
| SubagentStart `additionalContext` | 9,700 characters             | the whole text                       |
| SubagentStart `additionalContext` | 10,001 characters            | a preview, the tail lost             |
| Bash output                       | 27,000 and 29,000 characters | the whole text                       |
| Bash output                       | 31,000 and 40,000 characters | a 2 KB preview and a saved file path |

So the start hook carries the brief and the recipe, kept at or under 9,700 characters, and the rest
comes from `paqad-ai stage begin`. Its whole output stays at or under 27,000 characters, the
measured Bash limit of about 30,000 less 10 percent, because a preview would cut the JSON and cost
the second read the command exists to save.
