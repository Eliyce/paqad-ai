# Site-map samples (illustrative — schema draft 0)

Hand-authored examples accompanying [`../site-map-capability.proposal.md`](../site-map-capability.proposal.md), [`../site-map-capability.plan.md`](../site-map-capability.plan.md), and [`../site-map-capability.addendum.md`](../site-map-capability.addendum.md). They exist to make the planned artifacts tangible for review — **none of this is generated yet**, field names are draft, and counts are trimmed for readability. Evidence pointers reference real files in this repository where they exist.

| Sample | What it demonstrates |
| --- | --- |
| [`paqad-ai/`](./paqad-ai/) | The **hybrid app** case the owner described: one product with a CLI surface, a local web dashboard, and **LLM prompt workflows** as first-class mapped flows (prompt entry → router → staged workflow → decision pauses → receipt). Also: guards from config flags and capabilities, frontstage/backstage marking, journeys across all three surface families. |
| [`web-shop/`](./web-shop/) | The **typical web app** case: business-language labels resolved from **translation keys** (i18n), **permission** guards distinct from roles, a **feature-flag variant** of a surface, **external-system hand-offs** (payment, email verification), and an actor-lens (permission-bundle) view. Fictional app; evidence pointers are illustrative. |

Reading order: each sample's `app-map.yaml` first (the canonical graph), then `journeys/`, then `index.md` (the token-budgeted agent orientation layer, paqad-ai sample only).

Conventions demonstrated (from the proposal/plan/addendum):

- **Functional altitude**: surfaces are what a *user of the product* experiences; technical detail exists only as `evidence` provenance. Supporting machinery is marked `stage: backstage` and hidden by default in the visual map (service-blueprint frontstage/backstage).
- **Business language**: `label` is the human, business-language name. Where the code uses translation keys, `label_key` records the key and `label` the resolved default-locale text; the domain glossary in `module-map.yml` supplies preferred terms.
- **Incident encoding**: each surface lists its own outgoing transitions inline.
- **Guards are named and satisfiable**; actors are **permission bundles** (`satisfies:` lists), which is what makes "view as X" lenses computable.
- **Provenance everywhere**: `derivation` + `confidence` + `evidence` on anything non-obvious; human-curated fields are explicit.
