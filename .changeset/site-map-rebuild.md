---
'paqad-ai': minor
---

Rebuild the site-map workflow so it earns the trust it reports. The engine drafts the map
skeleton from proven extraction instead of the model hand-typing it, detects navigation links
from the code, records run progress so a new session resumes instead of restarting, batches every
preflight question into one interruption, and reports an honest verdict (Safe to merge / Needs
your attention / Inconclusive) when a map is absent or records no links. The dashboard gains a
full-screen map, a readable zoom floor, and live run progress. As the first step, the compiled
rule store is now recompiled automatically when it goes stale on the per-turn refresh path, and
`paqad-ai doctor` reports rule-store freshness, so the agent is never served a rule that no longer
matches the authored rules.
