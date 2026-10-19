---
'paqad-ai': patch
---

Fixed a Claude Code session running both the plugin and the npm hooks when the plugin stays passive in an npm-onboarded project. Now exactly one copy runs, so the Stop check no longer writes duplicate rows and prompt notes no longer print twice. `paqad-ai doctor` also says when a project still runs the npm hooks after the move to the plugin.
