---
'paqad-ai': patch
---

**Fix (#448): a legacy `.paqad/doc-progress.json` no longer blocks a site-map run.** Site-map
publication used to piggyback on the documentation workflow's `DocumentProgressTracker`, so every
`sitemap run` loaded and schema-validated `doc-progress.json` — and a file written by an older
paqad (an unrelated, disjoint shape) threw, aborting the run before `index.md` / `overview.md`
were published.

Site-map now keeps its **own** differential-refresh ledger at `.paqad/site-map/progress.json`
(schema-versioned, mirroring the tolerant persistence of the code-knowledge index: a missing,
corrupt, or schema-invalid file degrades to empty and self-heals on the next run rather than
crashing). Nothing under `src/site-map/` reads or validates `doc-progress.json` anymore, so an
unrelated stale ledger can never block a map publication or the site-map freshness gate. The two
concerns are decoupled by construction. All behaviour stays behind the OFF-by-default `site_map`
flag.
