---
'paqad-ai': minor
---

Add the automatic npm → paqad-plugin migration for Claude Code users (#621), **off by default**.

- New layered config knobs `plugin_migration` (`on`|`off`, default `off`) and `claude_install_mode` (`auto`|`plugin`|`settings`, default `auto`).
- `maybeMigrateToPlugin()` runs best-effort at the end of `paqad-ai update --silent`: it evaluates the skip conditions (migration off, install mode `settings`, no `claude-code` provider, CI/headless, already present, managed policy, retry rules), takes a single-flight machine lock, and installs via the `claude` CLI (Path A) or a safe additive merge into the user's `~/.claude/settings.json` (Path B). It never throws, never blocks, never prints in a session, and never touches a tracked project file or the npm package.
- Confirms the plugin actually loaded (via `plugin-seen.json`) before the npm copy steps aside, and undoes the move after 3 npm sessions with no sign of it (`rolled-back`). Supports the claude.ai synced route.
- `paqad-ai plugin rollback` undoes the move, pins `claude_install_mode=settings`, and prints the documented message; `paqad-ai doctor` reports the Claude Code install line.
- Guardrail: a new `tests/e2e/stage-enforcement-contract.e2e.test.ts` fences every paqad stage hook's block/allow behavior on both the npm and plugin routes.

The fleet-wide default flip (`plugin_migration` → `on`) and the manual sign-off scenarios are intentionally out of scope and ship separately.
