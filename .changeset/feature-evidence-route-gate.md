---
'paqad-ai': minor
---

fix(#390): gate feature-evidence bundle creation + report render to the feature-development route

Feature-evidence artifacts — the `feature-evidence/change-<ULID>/` bundle,
`stage-evidence.jsonl`, `report.html`, `receipt.json`, `ai-bom.json`, `rag.jsonl`,
and `_session/<id>.json` — were created for **every** workflow, not only
feature-development. A `root-cause-analysis` (or any non-feature) session that emitted
`paqad:stage` markers and reached Stop still minted a `change-<ULID>` bundle and a
`report.html`, because both the marker-driven auto-open and the report/receipt render
gated only on "is a feature pointer active?" (`currentFeature() != null`), never on the
routed workflow.

Both seams now consult the **persisted route** via `isFeatureDevelopmentRoute` (a new
`routeIsAffirmativelyNonFeature` helper), not the working-tree diff:

- `parseAndRecordMarkers` records nothing when the route is affirmatively
  non-feature-development, so no bundle or `_session` control is minted.
- The per-feature receipt/AI-BOM projection and `renderActiveFeatureReport` in
  `run-repository-verification.ts` write nothing when the route is affirmatively
  non-feature-development, even if a pointer leaks through.

**Cross-provider safe by design:** suppression fires **only** on a route we can prove
is non-feature. The route seam runs only in Claude's UserPromptSubmit hook, so
Codex/Gemini sessions — which record markers through the same recorder but never write
route state — have **no** route state; an absent route is treated as "unknown" and
preserves today's recording behaviour rather than silently killing all cross-provider
feature-evidence. Feature-development behaviour is unchanged.
