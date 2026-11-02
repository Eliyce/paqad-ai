---
'paqad-ai': minor
---

Move delivery rules to .paqad/configs/git-workflow/, add the git-workflow skill that owns them, and make paqad follow and check them for agents and people.

The five files (`tickets.yaml`, `branches.yaml`, `commits.yaml`, `pull-requests.yaml` and `enforcement.yaml`) replace `docs/instructions/workflows/delivery-policy.yaml`, which `paqad-ai update` migrates once and deletes. `paqad-ai deliver` follows every setting, the end-of-turn check and the commit-msg and pre-push hooks check the rules, the dashboard's Git workflow page edits one file per tab, and `paqad-ai doctor` reports problems in a new `git-workflow` check. Ask your agent to change the rules through the git-workflow skill.
