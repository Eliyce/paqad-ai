# Reading the project

Read only what the idea or the question needs, and read it in this order (GRD-2). Stop as soon
as the documents answer the point. Never read runtime state, the rules folder, secrets or
environment files.

| Order | Path | Why |
|---|---|---|
| 1 | `docs/instructions/registries/modules.md` | The map: every module, its plain name, its layer and its features. With no modules list (partly ready), build the map from the `docs/modules` folder names and their summaries. |
| 2 | `docs/modules/<module>/index/summary.md` for each candidate | What the area is for. |
| 3 | `docs/modules/<module>/features/<feature>/business.md` | Roles, flows and business rules. The main grounding source. |
| 4 | `docs/site-map/` (if present: `app-map.yaml`, `journeys/`) | Screens, navigation and journeys. |
| 5 | `docs/instructions/architecture/overview.md`, `docs/instructions/stack/overview.md` | Only for cross-cutting constraints. Never quoted in ticket text. |
| 6 | `docs/modules/<module>/features/<feature>/technical.md` | Only to settle a fact that the business notes cannot. Never quoted in ticket text. |
| 7 | Source code | Only if it is attached and steps 1 to 6 left a material gap. Reported as what the code suggests. |

Onboarded check first (GRD-1). An empty or whitespace-only file counts as missing.

- Ready: `docs/instructions/registries/modules.md` and at least one
  `docs/modules/<module>/index/summary.md`. Carry on.
- Partly ready: at least one summary but no modules list. Carry on, say once, exactly:
  "This project's list of areas is missing, so I'm working from the area summaries it has. Areas without a summary are shown as unknown."
- Not set up: no summary, whatever else exists. Stop with, exactly:
  "This repository isn't set up for this yet. Ask your engineering team to onboard it with paqad, then come back."

Every fact taken from these documents carries the path it came from on a single Sources line
(GRD-5). Where a needed section is still a blank template, say what the documents cannot
confirm and never fill the gap with a guess (GRD-4).
