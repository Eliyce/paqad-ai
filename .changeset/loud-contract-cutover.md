---
'paqad-ai': minor
---

Deliver the feature-development contract to the model and finish the per-feature evidence cutover (#345, #343).

- **#345 G2/G3** — rule triggers are now scoped to path/glob-shaped inline code (fenced code blocks stripped), so a rule doc without an explicit `<!-- trigger: -->` no longer scoops up prose/code as triggers. This kills the `` `, ` `` manifest corruption and the whole-doc bloat/over-match (a representative repo artifact drops from ~128 KB to ~75 KB with zero manifest-region corruption). The manifest renders triggers as space-separated single backtick spans and strips backticks from the summary teaser; retrieval slices are deduped.
- **#345 G4** — the rule-scripts checks verdict now says **⚪ none armed** at the completion seam instead of silently passing when no rule-scripts are registered.
- **#345 G5** — the conservative decision-pause self-arm defaults **on within feature-development** (env/config can still force it either way) and never arms on any other route; a compact "decision pause is active" reminder rides with the feature-development rule slice.
- **#345 G6** — a single exclusivity test proves every non-feature-development route loads no rules, runs no rule-scripts, and arms no decision pause.
- **#343 A** — the frozen spec's only home is the feature bundle `specification.json` (the `.paqad/specs/*.frozen.json` sidecar and `frozen-spec-store.ts` are retired); the planning `<slug>.yaml` manifest relocates to `.paqad/planning/manifests`; the dashboard counts specs from the feature bundles; `.paqad/specs` and `.paqad/plans` are removed.
- **#343 B** — per-feature `receipt.json` + `ai-bom.json` are projected from a feature's own graded rows (reusing the in-toto/DSSE/CycloneDX machinery), and the whole-project AI-BOM can be projected on demand from the union of feature bundles; per-feature writes honour the same enterprise gating as the whole-project receipt.
