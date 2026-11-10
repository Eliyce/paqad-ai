---
'paqad-ai': minor
---

Add the rules discovery workflow. Say "discover rules" and paqad lists the packages the project uses, turns settled decisions and sourced research into rule ideas, merges them with your existing rules into one proposal you sign off, then writes the rules, tags the decisions and refreshes the stack docs. New verbs live under `paqad-ai rules discovery` (`start`, `status`, `decisions`, `research`, `propose`, `review`, `sign-off`, `apply`, `docs`) beside `paqad-ai rules inventory`. The full rule reset is removed: `paqad-ai refresh --rules` and `--force` and the dashboard "Refresh the rules" action are gone; onboarding still copies the default rules once.
