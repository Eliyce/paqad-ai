---
'paqad-ai': patch
---

fix(#386): batch onboarding's git check-ignore to a single call

Repository discovery spawned two synchronous `git check-ignore` subprocesses per
visited directory, so onboarding stalled for seconds before the provider prompt on
large repositories. It now walks the tree once into memory and resolves all
git-ignored paths with a single batched `git check-ignore` call, cutting spawns
from O(directories) to O(1) with identical detection output.
