---
'paqad-ai': patch
---

Fix #641: onboarding through the Claude Code plugin no longer takes over the shared npm framework link, and npm-onboarded repos run a single hook chain.

- `bootstrap.ts` now applies the same plugin-aware rule as the plugin's SessionStart when `onboard`/`join`/`install` run from the plugin bin: a link pointing at a working npm install is left untouched, and a missing or dangling link is pointed at `${CLAUDE_PLUGIN_DATA}/runtime` rather than the version-specific cache runtime. Running from the npm install is unchanged.
- The plugin's one-copy handshake (`hasLiveNpmHookLines`) now also inspects the project's `.claude/settings.json` and `.claude/settings.local.json`, so the plugin stays passive in a repo the npm copy already wires — each paqad hook fires once per event, not twice.
- Onboarding under the plugin omits the npm hook chain from the project's `.claude/settings.json`, since the plugin supplies its own.
- `onboard --stack <bad>` now lists the valid stacks instead of an opaque schema error, and the `onboard` skill documents the `--detect --json` null-stack case.
