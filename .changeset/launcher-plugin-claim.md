---
'paqad-ai': patch
---

The committed team launcher (`.paqad/hook.mjs`) now stands down only when the paqad plugin has claimed the session, not when it is merely installed. Before, the first Claude Code session after the plugin was installed ran with no paqad checks at all, because the plugin only loads in the next session. Run `paqad-ai update` and commit the refreshed launcher.
