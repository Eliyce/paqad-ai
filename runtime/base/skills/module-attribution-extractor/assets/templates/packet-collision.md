<!--
Decision Pause packet template — "near-collision" candidate.
Variables: {{slug}} {{collision_with}} {{excerpt}}
-->

**Header:** Slug collision

**Question:** "{{slug}}" is suspiciously close to existing module "{{collision_with}}" — confirm which one this is.

**Detected in:** `{{excerpt}}`

**Options:**

- **Use existing `{{collision_with}}`** — resolve to the existing slug; mark the draft `superseded`.
- **Accept new module `{{slug}}`** — promote MD-XXXX; apply.ts mutates `module-map.yml`.
- **Rename** — collect a new slug; loop back through `module-attribution-extractor`.
- **Reject** — mark the draft `rejected`; no map mutation.
