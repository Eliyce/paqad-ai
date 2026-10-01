---
'paqad-ai': minor
---

Add `paqad-ai new project <name>` and the Slice 3 setup journey (#596). `new project` creates a development workspace — directory, git, `.paqad`, docs scaffolding and host entry files — with an explicitly undecided application stack (no framework default) and a safe non-empty/rerun guard, reusing the onboarding engine without touching `onboard`/`install`/`update`. A new `paqad-ai setup` command records and validates a dependency-ordered setup plan, tracks step state, and verifies readiness to develop; paqad records the official install steps but runs no installer itself.
