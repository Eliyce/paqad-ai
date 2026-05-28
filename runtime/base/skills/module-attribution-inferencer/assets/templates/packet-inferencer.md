<!--
Decision Pause packet template — inferencer hypothesis.
Variables (single): {{question_lead}}
Variables (per choice in choices[]): {{label}} {{kind}} {{reasoning}}
-->

**Header:** Module attribution

**Question:** {{question_lead}} Which module does this prompt belong to?

**Options:**

- For each `choices[]` entry:
  - `extend-existing` → **Extend "{{label}}"** — {{reasoning}}
  - `new-module-fallback` → **Introduce a new module** — collect a name, then hand off back to `module-attribution-extractor`.
  - `no-attribution` → **Skip attribution for this prompt** — continue planning with no map mutation; record nothing.

**Notes:**

- Lead the question with `No existing module clearly matches — pick one of:` when `confident === false` (see `is-confident.sh`).
- Only an explicit `Extend "..."` selection promotes a draft to `accepted`.
- `new-module-fallback` loops back through the extractor; `no-attribution` writes nothing.
