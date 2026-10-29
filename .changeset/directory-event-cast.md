---
'paqad-ai': patch
---

The plugin directory no longer blocks the paqad plugin with "couldn't confirm that the mod leaves a permission decision with the user". The directory accepts no plugin hook that reads Claude Code's permission answer, so the HUD no longer has one. Two small things change:

- While Claude Code's own permission dialog is open, the band no longer says "Waiting for your answer". It still says it for a pending paqad decision and for a question in the chat.
- After **Allow once**, an edit that is denied again is recorded as "still blocked", without saying whether you refused the dialog or another rule blocked it.
