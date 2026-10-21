---
'paqad-ai': patch
---

The release now ships the Claude Code plugin, the `v<version>` git tag and the GitHub Release on every npm publish, decided from npm and the plugin repo instead of the changesets console output, and a check fails when the plugin falls behind npm. `paqad-ai decision resolve` also resolves packets the hooks write, which used to crash it.
