---
'paqad-ai': patch
---

`git status` is clean again after a session. Hooks write lock and marker files under `.paqad/locks/`, and that folder was not in the list paqad keeps in `.paqad/.gitignore`, so every session left it untracked. Fresh onboarding now ignores `locks/`, and `paqad-ai update` adds it to existing repos.
