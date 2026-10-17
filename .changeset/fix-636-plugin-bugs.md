---
'paqad-ai': patch
---

Fix three Claude Code plugin bugs from 1.96.0 (#636).

- The plugin installs at user scope and ran its hooks in every repo, so in a project that was never onboarded the entry gate blocked the first edit and the model was pushed to create a `.paqad/` folder in an unrelated repo. Every plugin-reached hook now stands down to a pure no-op (exit 0, no output, no `.paqad/` write) when the project has no `.paqad/framework-path.txt`; enforcement in onboarded repos is unchanged.
- `plugin-session-start.mjs` used a raw entry-point guard (comparing the module URL against an un-normalized `process.argv[1]`) that missed on Windows, on paths with spaces, and on symlinked paths (macOS `/tmp` to `/private/tmp`), so the hook silently did nothing — no PATH setup, no version refresh. It now uses the same realpath-safe guard as the other hooks, shared in one place so the broken form cannot return.
- The plugin re-pointed the shared `~/.paqad-ai/current` link at its version-specific cache runtime; when that cache was removed, the link dangled and blocked every edit in every npm-onboarded project (and in Codex/Gemini). The plugin now never takes over a link that resolves to a working npm install, and when it fills a missing or dangling link it targets a stable location that survives cache version churn. `paqad-ai doctor` now prints the exact repair command for a dangling link.
