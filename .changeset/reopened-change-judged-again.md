---
'paqad-ai': patch
---

A change that was closed at the end of a turn and then reopened is now checked again when the turn ends. Before, the session that reopened it was treated as owning no change, so the final check was skipped, the change stayed open, and the dashboard verdict and receipt kept the first result. Only the session that reopened the change owns it; other sessions still never pick up a closed change. Also, a code request that lists its steps ("build, review and docs sync, checks") is no longer routed to the documentation workflow because of the words "docs sync". A request with no code words still routes "documentation sync" to the documentation workflow.
