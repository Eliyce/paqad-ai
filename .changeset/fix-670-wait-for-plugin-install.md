---
'paqad-ai': patch
---

The move to the Claude Code plugin no longer gives up too early on the Desktop app. Sessions only count toward undoing the move once Claude Code has actually installed the plugin, since the Desktop app can take a few starts to do that. If the plugin is still not installed a week after the move, paqad undoes it and tries again later. While it waits, `paqad-ai doctor` says `npm (migration installed: waiting for Claude Code to install the plugin)`.
