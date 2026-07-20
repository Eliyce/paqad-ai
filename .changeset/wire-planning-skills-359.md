---
'paqad-ai': minor
---

Wire the idle planning skills into the enforced stage contract (#359): four fully-built-but-never-invoked planning helpers now run when relevant, and only when relevant.

- The enforced feature-development **planning stage** gains three lane-gated instruction blocks, sourced from one shared set of constants so the default policy object and the rendered `feature-development.yaml` cannot drift: an all-lanes reuse reflex (consult the Existing surface + `index query`, follow the solution-architect Reuse / Extend / Build-new procedure), a graduated/full block that runs `diff-minimizer` before the plan compiles and `existing-doc-checker` before any new doc, and a graduated/full multi-module block that runs `cross-module-impact-scanner`.
- **Lane honesty:** a fast-lane change pays exactly one sentence; no skill procedure loads for it. A new `reusePlanningInstructions(lane, { multiModule })` assembler is the single source of that lane-gating logic.
- The #357 plan schema now accepts an optional per-step `classification` (`ac-satisfying` | `necessary-setup` | `scaffolding` | `over-build`) so a diff-minimizer verdict can ride in the compiled `plan.json`; a plan without it stays valid.
- No new hook and no new runtime gate — the skills feed fields the schema already checks, and the wired-vs-sidelined map in the onboarded-project overview is updated to keep it honest.
