# Reading the project

Read only what the idea or the question needs, and read it in this order (GRD-2). Stop as soon
as the documents answer the point. Never read runtime state, the rules folder, secrets or
environment files.

| Order | Path | Why |
|---|---|---|
| 1 | `docs/instructions/registries/modules.md` | The map: every module, its plain name, its layer and its features. |
| 2 | `docs/modules/<module>/index/summary.md` for each candidate | What the area is for. |
| 3 | `docs/modules/<module>/features/<feature>/business.md` | Roles, flows and business rules. The main grounding source. |
| 4 | `docs/site-map/` (if present: `app-map.yaml`, `journeys/`) | Screens, navigation and journeys. |
| 5 | `docs/instructions/architecture/overview.md`, `docs/instructions/stack/overview.md` | Only for cross-cutting constraints. Never quoted in ticket text. |
| 6 | `docs/modules/<module>/features/<feature>/technical.md` | Only to settle a fact that the business notes cannot. Never quoted in ticket text. |
| 7 | Source code | Only if it is attached and steps 1 to 6 left a material gap. Reported as what the code suggests. |

Onboarded check first (GRD-1): the repository counts as set up only when both
`docs/instructions/registries/modules.md` and at least one
`docs/modules/<module>/index/summary.md` exist. If either is missing, stop and ask the
engineering team to onboard the repository before continuing.

Every fact taken from these documents carries the path it came from on a single Sources line
(GRD-5). Where a needed section is still a blank template, say what the documents cannot
confirm and never fill the gap with a guess (GRD-4).
