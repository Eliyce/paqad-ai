---
'paqad-ai': patch
---

The plugin directory no longer blocks the paqad plugin with "couldn't confirm that the mod leaves a permission decision with the user". The HUD's permission hook now reads which subagent a call comes from directly, without a type cast the directory can't read. Nothing changes in how the HUD behaves.
