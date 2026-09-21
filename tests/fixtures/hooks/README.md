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
