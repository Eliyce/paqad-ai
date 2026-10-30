---
'paqad-ai': patch
---

Releases are faster and no less checked. `npm publish` no longer runs the whole test suite again inside Actions: the release first proves that the 4 required CI checks passed on a tree identical to the one being published, and refuses to publish otherwise. A publish from anywhere else still runs `pnpm run ci` in full. The plugin is pushed as soon as changesets publishes, without waiting for npm to list the version, and every `npm view` now asks the registry for a fresh answer. A version-only release PR, and a push to `main` whose files match a PR that just passed, skip the test matrix only when that proof holds; anything else runs it in full. The slowest test file is split into four.
