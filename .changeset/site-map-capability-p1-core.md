---
'paqad-ai': minor
---

New **Site Map** capability — the deterministic core (P1), behind an OFF-by-default `site_map`
flag (env `PAQAD_SITE_MAP`). With the flag off nothing changes; when on and the coding capability
is active, `paqad-ai sitemap run` maps the application — its surfaces (pages, screens, endpoints,
CLI commands), transitions, guards, and areas — reconciles them against a canonical
`docs/instructions/site-map/app-map.yaml`, runs Tier-A verification (evidence resolution,
cross-reference integrity, graph invariants), and publishes a token-budgeted `index.md`, a
deterministic Mermaid overview, and screen/API registries. Zero model tokens: the engine mirrors
the codebase-health pattern (injectable gatherer → pure assemble → exit-code-as-verdict).

This release wires the capability into the framework:

- **Routing**: `site-map` and `site-map-retest` are routed workflows (mirroring
  codebase-health / health-retest). Verb-qualified triggers keep a literal `sitemap.xml` feature
  request on the feature-development path.
- **Skills, roles, and rules**: the `site-map` / `site-map-retest` workflow rules, the
  `app-cartographer` agent role, and the fine-grained P1 skills (readiness, extraction, modeling,
  transition-tracing, guard-inference, assembly, verification, gap-analysis, publication,
  maintainer, retest).
- **Freshness gate**: a feature-development change that drifts the map cannot reach "Safe to
  merge" while a published view is stale — inert unless the flag is on.
- **Retest**: `paqad-ai sitemap retest` replays a prior report by stable `SM-` id (never invents a
  finding, never lowers severity, never calls the absence of proof a fix).

The React dashboard Site map area and the journey-synthesis / human-curation layer are deferred to
a follow-up.
