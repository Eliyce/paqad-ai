---
'paqad-ai': minor
---

Fix and enforce silent self-update so onboarded installs actually stay current.

The session-start update hook was effectively dead: it was never wired into the
Claude Code `SessionStart` hooks, and even when run it only regenerated project
artifacts via `npx paqad-ai@latest update` — it never upgraded the globally
installed CLI, so a user's `paqad-ai` version never changed. On macOS it was
doubly broken because the hook depended on GNU-only `timeout` and `flock`, which
are absent on stock macOS, so the version check silently no-opped every session.

Now:

- `silent-update.sh` is registered as a Claude Code `SessionStart` hook on
  onboard/refresh, so the check runs every session.
- When a newer version exists it runs the real upgrade —
  `npm install -g paqad-ai@latest` followed by `paqad-ai update --silent` — in
  the background. It never blocks, prompts, or prints to the user.
- A two-minor-version policy is enforced: the allowed window is the latest minor
  and the one before it within the same major. Anything older (a minor beyond
  the band, or an older major) is classified as a `forced` update in the audit
  log so stale installs are visible.
- The hook now resolves the project root from `CLAUDE_PROJECT_DIR`/`pwd` and
  degrades gracefully when `timeout`/`flock` are missing (`gtimeout`/bare `npm`
  and an atomic-`mkdir` lock with stale-lock reaping), so it works on macOS.
