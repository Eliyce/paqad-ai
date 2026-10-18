---
'paqad-ai': patch
---

Fixed the move from the npm package to the Claude Code plugin (#648). It is still off by default.

- It now uses the right marketplace, `Eliyce/paqad-ai`. The old name did not exist, so the move could never work.
- When `claude` is on your path, paqad registers the marketplace, installs the plugin, and checks that Claude Code really recorded it. If any step fails, it falls back to your user settings and writes the reason to `~/.paqad-ai/logs/plugin-migration.log`.
- paqad now counts real Claude Code sessions before it undoes a move. Three sessions in a row with no sign of the plugin undo it. Before, it counted background updates, which only run when a new version is out, so a broken move could sit there for weeks.
- An automatic undo is tried again after a day, up to five attempts, so a blocked download recovers once access is back. A `paqad-ai plugin rollback` you run yourself stays final.
- If you turn the plugin off in your Claude settings after the move, paqad records that you declined it, shows it in `paqad-ai doctor`, and never turns it back on.
- `paqad-ai plugin rollback` now really removes the plugin through `claude plugin uninstall`, as its message says.
- Choosing `claude_install_mode=plugin` right after a skip no longer waits a day. Skips caused by your own config or environment never hold back the next run.
