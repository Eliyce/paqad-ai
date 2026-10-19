---
'paqad-ai': patch
---

`paqad-ai doctor` now names the settings file that keeps the npm hooks running after the move to the plugin. It used to blame the project settings even when the hooks were wired in your user settings. It now checks your user `~/.claude/settings.json` first (or the one in `CLAUDE_CONFIG_DIR` when you set it), then the project files, and names each file it finds.
