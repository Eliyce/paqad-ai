---
'paqad-ai': minor
---

Rebuild the Site map dashboard canvas as an interactive city map (issue #489).

On real, edge-sparse maps (this repo's own: 92 surfaces, 0 transitions) the previous
canvas degenerated into an illegible vertical sliver, could not zoom to legibility, and
leaked pinch-zoom to the whole page. The canvas now runs on React Flow 12 with a
deterministic containment-first district layout of our own:

- **Districts carry the structure.** Areas render as tinted district rectangles with a
  surface-card grid inside; a zero-transition map is a first-class citizen. Correct
  gesture substrate (cursor-anchored zoom, pinch, non-passive wheel, scroll-pans-by-default
  with a per-user setting, minimap) replaces the hand-rolled pan/zoom.
- **Journeys are metro lines.** Each journey draws as a colored polyline through its own
  ordered stations (no transitions needed), with walk-mode camera flights, numbered
  stations, interchange rings, semantic-zoom levels of detail, and a cmd/ctrl+K search that
  flies to a surface, area, or journey. All motion respects `prefers-reduced-motion`.
- **The map wears its verification state.** Trust tier changes a surface's rendering
  (solid/dashed/sketch, distinguishable without color), unverified surfaces sit under
  honest fog, and a payload-derived insight line plus a gaps chip surface dead surfaces,
  dangling targets, and broken journey references.
- **Team-shared curation.** Districts are draggable; the arrangement persists to
  `docs/site-map/layout.yaml` through the dashboard's audited write path (refused in
  `--read-only`), and a stored district is pinned and never auto-reflowed.

Everything still renders statically from `GET /api/site-map/map` with no LLM at view time;
the #466 data model, detail panel, honesty strip, list toggle, and SSE live-reload are
unchanged.
