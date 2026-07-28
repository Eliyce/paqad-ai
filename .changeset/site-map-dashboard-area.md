---
'paqad-ai': minor
---

**Site map is a dashboard area now, not a command you type (#448).** Open `paqad-ai dashboard`
and there is a **Site map** entry in the side menu: it shows the latest run (surfaces, journeys,
findings, skipped checks) and a **Run site map** button that maps the app on demand. The run is
the same deterministic, zero-token audit the engine always did — it just happens from the web,
with live progress and a dashboard-attributed line in the audit trail, so no one has to drop to a
terminal.

The `paqad-ai sitemap` verb still exists for CI and scripting, but it is now hidden from `--help`
(the dashboard is the place to run it), mirroring how `graph` became a dashboard area. Everything
stays behind the OFF-by-default `site_map` flag.
