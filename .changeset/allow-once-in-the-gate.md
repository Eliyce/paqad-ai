---
'paqad-ai': patch
---

Allow once now works on every Claude Code plan, including Team and Enterprise logins and machines with Claude Code managed settings. The HUD never changes a permission answer any more: after you pick **Allow once, recorded**, it records the override and runs the same edit again, and paqad's own gate asks Claude Code to show its permission dialog for that one edit. A deny from your settings rules, another tool's hook or a rule your organization enforces still blocks it. A second line in the change's evidence now says whether the allowed edit landed, was refused or stayed blocked (`paqad-ai rules override --outcome`). The plugin also no longer ships `dist/plugin/` or raw control bytes in its bundled files, which the plugin directory flagged.
