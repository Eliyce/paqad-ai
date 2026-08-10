---
'paqad-ai': minor
---

Begin the interactive visual site map (#466). The dashboard "Site map" area becomes an explorable, non-technical diagram of the app rendered statically from a single AI-authored YML at `docs/site-map/`, and creating the map is gated on the documentation family. This first slice lays the data foundation: an honest 5-level trust tier on every map element (surface, transition, guard, journey), a reader for the canonical `docs/site-map/` location, and a write path that stamps each element's earned trust tier into the stored map so the dashboard renders proven tiers statically with no work at view time. Everything stays inert while the `site_map` flag is off.
