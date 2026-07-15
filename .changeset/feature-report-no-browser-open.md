---
'paqad-ai': minor
---

feat(#388): stop auto-opening report.html in the browser and remove the `feature_report_auto_open` config option

The per-feature `report.html` no longer opens in the OS browser. The auto-open-on-completion
path (fired by the completion hook) and the manual `paqad-ai feature report --open` path are
both removed, and the sandbox-aware opener (`report-open.ts`) is deleted — no code path opens a
browser anymore.

**Removed config key:** `feature_report_auto_open` is gone from the config registry, resolver,
serializer, listing, the project-profile type and JSON schema, the onboarding default seed, and
the generated config templates. On the next onboard/update the config-split reconcile (#227)
prunes the key from team/local `.config.*` files, so existing projects stop opening the browser
without manual edits — every still-valid value is preserved.

Report **generation** is unchanged: the `feature_report` flag (default on) and
`renderActiveFeatureReport` still write `report.html` into the feature bundle exactly as before.
