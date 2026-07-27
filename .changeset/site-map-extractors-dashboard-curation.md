---
'paqad-ai': minor
---

Three follow-ups to the **Site Map** capability, all behind the OFF-by-default `site_map` flag:

- **Dedicated React + Laravel route extractors** — `paqad-ai sitemap run` now maps real web apps
  with high-confidence surfaces (React Router routes → pages, Laravel `Route::` declarations →
  page/api by uri), instead of only the generic convention fallback. Unknown shapes still fall
  through to the fallback, never a guess.
- **Dashboard Site map area** — the dashboard gains a scored "Site map" section (surfaces,
  journeys, open findings, freshness) built from the published run sidecar, so the map is visible
  rather than only files.
- **Journey curation** — `paqad-ai sitemap journey confirm|reject <id>`, the human sign-off that
  turns a proposed journey into a confirmed one (or removes it), recorded on an audit ledger. The
  code never self-confirms.
