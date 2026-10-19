---
'paqad-ai': patch
---

Routing gets your intent right more often, and a wrong label is easy to fix.

- `paqad-ai route set` now refuses to leave feature development only when your own session edited source this turn. Another session working in the same folder no longer blocks your correction. If no session id can be found, the correction is allowed and written to the route override log.
- Setting the route back to a paused workflow resumes that paused change, so no stray paused copy is left behind.
- Messages about the work itself, such as posting an issue, updating a draft or linking a ticket, go to project question instead of feature development. A real code request that mentions a report, a plan or a doc still goes to feature development.
- A subagent's report or a background task notice is never routed as if you had typed it, wherever its notice banner sits in the message.
