---
'paqad-ai': minor
---

Onboarding is now one journey you start with one click. In Claude Code, `/paqad onboard` asks one question, which AI tools your team uses, and then runs eight steps in order (Read, Set up, Docs, Modules, Research, Triage, Checks, Wrap up) without stopping to ask. The Onboarding band in the HUD shows each step, its progress such as "7 of 23 modules", and a Resume control when a step stops. In other AI tools with skills, say "onboard paqad" and the onboarding-journey skill runs the same steps and narrates one status line per step.

A new `paqad-ai onboarding` command group drives the journey: start, detect, choose-stack, setup, next, stage, unit, progress, decide, status, choices, resume, finish, commit and abandon. A step cannot start before the one above it is done, and cannot end without proof from this run. Resume restarts a stopped step at its first unfinished unit, and recounts modules against the current module map.

Choices the journey makes for you are recorded in `.paqad/onboarding/choices.jsonl`. List them with `paqad-ai onboarding choices` and mark them reviewed; until then they are not reused as "same as last time". Rule checks the journey adds only warn until they are reviewed. Existing hand-written docs pages are kept as they are and listed for review in the finish report. At Wrap up the journey asks once whether to commit its files on a new branch; answering no leaves them uncommitted and says how to commit them later.

Five new agents, `paqad-onboarding-docs`, `paqad-onboarding-modules`, `paqad-onboarding-rules`, `paqad-onboarding-analyze` and `paqad-onboarding-scripts`, do the docs, module, research, triage and checks steps in Claude Code. Each writes only under `docs/` and `.paqad/`, and a module agent only under its own module folder.
