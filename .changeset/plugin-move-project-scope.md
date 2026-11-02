---
'paqad-ai': patch
---

In a repo that commits the paqad plugin in `.claude/settings.json`, the plugin move's off-switches now work and `paqad-ai doctor` tells the truth. Doctor says `plugin (turned on by this project)` when the plugin loads there, instead of `npm`. `paqad-ai plugin rollback` turns the plugin off for you only, in the git-ignored `.claude/settings.local.json`, instead of saying the plugin was removed while it still loads. The background move skips the user-scope install where the project already turns the plugin on, and every install path now writes a line to `plugin-migration.log`. A team that sets `claude_install_mode=settings` in its tracked `.paqad/configs` file no longer gets the plugin keys written back into the shared settings on `update`.
