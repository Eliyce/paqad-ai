<!--
Decision Pause packet template — "unknown" candidate.
Variables: {{display_name}} {{slug}} {{excerpt}} {{pattern}}
-->

**Header:** New module

**Question:** Confirm new module "{{display_name}}" (slug: `{{slug}}`)?

**Detected in:** `{{excerpt}}` (pattern: `{{pattern}}`)

**Options:**

- **Accept** — promote MD-XXXX from `draft` → `proposed` → `accepted`; apply.ts mutates `module-map.yml`.
- **Rename** — collect a new slug; loop back through `module-attribution-extractor`.
- **Reject** — mark the draft `rejected`; no map mutation.
