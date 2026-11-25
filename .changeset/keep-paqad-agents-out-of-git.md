---
'paqad-ai': minor
---

paqad's own agents and recipes now stay out of git. paqad writes them in every project on onboard, update, join and every session start, and a managed block in `.claude/agents/.gitignore` and `.agents/skills/.gitignore` ignores them by the `paqad-` name pattern. Recipe skills are renamed `paqad-<stage>-recipe`. The first manual `paqad-ai update` on a project that committed them untracks them (they stay on disk) and asks you once to commit the removal. Your own agents and skills stay visible to git.

The committed team launcher `.paqad/hook.mjs` is gone, and no paqad code clones the plugin from GitHub any more. Teammates get paqad from the plugin that the committed `.claude/settings.json` turns on. A Claude Code cloud session gets it from three environment setup commands with the team's exact version: `npm i -g paqad-ai@<version> && paqad-ai install && paqad-ai join --no-rag --non-interactive`. Onboard and update print the command with the version filled in. The first manual update removes the launcher and its hook lines and asks you to commit the removal. A stage dispatched with no paqad stage agent stops with one line asking for a new session.

`updates.automatic` and `updates.minimum_version` now decide updates for the npm package, the plugin and the cloud command alike. Turning updates off writes `autoUpdate: false` on the plugin marketplace in `.claude/settings.json`. `updates.minimum_version` is now an exact pin for the npm route and the cloud command; the plugin route can be stopped but not pinned. `paqad-ai config set updates.automatic false` changes the setting and the marketplace key at once.
