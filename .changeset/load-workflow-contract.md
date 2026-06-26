---
'paqad-ai': minor
---

Load the workflow policies as part of the canonical project contract. The framework bootstrap and the agent-entry hooks now instruct the agent to load `docs/instructions/workflows` (the feature-development and delivery-policy workflows) alongside `rules`, `stack`, and `design-system`. Previously the workflow policy files shipped but were never named by anything the agent loads, so they were never read. Regression guards assert the workflows dir stays in the load list in both the bootstrap and the entry-gate hooks.
