# Site Map — dedicated extractors, dashboard area, journey curation (spec)

Three follow-up features on the shipped site-map capability, all behind the OFF-by-default
`site_map` flag and the coding capability.

## Functional requirements

- FR-1: A dedicated React-route extractor turns declared routes (React Router route objects and
  Next.js `app/`/`pages/` files) into `page` surfaces with resolving `file:line` evidence and high
  confidence.
- FR-2: A dedicated Laravel-route extractor turns declared routes (`Route::get('/x', ...)` etc.)
  into `page`/`api` surfaces with resolving `file:line` evidence and high confidence.
- FR-3: Both extractors feed the same `assembleExtraction` dedupe/fingerprint path as the existing
  node-cli extractor; an unrecognised shape falls through to the generic fallback, never a guess.
- FR-4: A dashboard Site map area reads the published site-map artifacts (canonical map, index,
  overview, registries, latest findings) and exposes them as a dashboard section.
- FR-5: A journey-curation flow confirms or rejects a `proposed` journey through the audited
  decision surface, writing the status transition (`proposed` -> `confirmed`/`rejected`) back to
  the journey file, and never self-confirms.

## Invariants

- INV-1: With the `site_map` flag off (the default) nothing changes — the extractors only run
  inside the flagged verb's gatherer, and the dashboard area and curation verb are inert.
- INV-2: Every extracted surface carries at least one resolving `file:line` evidence pointer; an
  extractor never emits a surface it cannot ground.
- INV-3: A journey only becomes `confirmed` through a resolved decision packet, never by the
  synthesis or curation code on its own.

## Acceptance criteria

- AC-1: `extractReactRouteSurfaces` maps a list of declared React routes to `page` surfaces with
  resolving `file:line` evidence and high confidence, and drops nothing silently.
- AC-2: `extractLaravelRouteSurfaces` maps declared Laravel routes to `page`/`api` surfaces by uri
  prefix, each with resolving evidence and high confidence.
- AC-3: Both extractors feed `assembleExtraction` so their surfaces are deduped and fingerprinted
  alongside the node-cli and generic extractors.
- AC-4: The dashboard exposes a Site map section built from the published artifacts, and renders
  nothing when the capability is off.
- AC-5: The curation verb transitions a `proposed` journey to `confirmed`/`rejected` only through a
  resolved decision packet, and writes the status back to the journey file.
