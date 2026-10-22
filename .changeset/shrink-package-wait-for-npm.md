---
'paqad-ai': patch
---

The npm package is much smaller: about 9 MB unpacked instead of 69 MB, and a 2.4 MB download instead of 15 MB. It no longer ships source maps, and the bundles share their common code instead of each carrying a copy. The dashboard finds its files the same way from any build layout. Each release now waits up to 15 minutes for npm to list the new version before it decides whether to publish the Claude Code plugin, so the plugin no longer falls behind npm.
