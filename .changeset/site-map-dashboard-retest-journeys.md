---
'paqad-ai': minor
---

**Site map dashboard: Retest and journey sign-off from the web (#448).** The Site map area now
carries the last two actions that used to need the terminal:

- **Retest** replays the latest run against the current code (a `site-map-retest` dashboard
  action, with live progress). If there is no prior run to replay it says so instead of failing
  obscurely.
- **Journeys** lists the app's journeys and lets you **Confirm** or **Reject** the proposed ones
  in place. Confirming makes a journey part of the map; rejecting drops it. Both run the same
  audited curation the engine always did.

The run itself is unchanged. Everything stays behind the OFF-by-default `site_map` flag, and the
`paqad-ai sitemap` verb remains available (hidden) for CI and scripting.
