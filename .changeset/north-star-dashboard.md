---
'paqad-ai': minor
---

North Star Dashboard: the project graph becomes a trust-building, first-class dashboard area (epic #166).

- Graph is now a dashboard area served by the dashboard server itself (read-only `/api/graph`, `/api/node/:id`, `/api/chunk/:id/content`, `/api/similar`); the standalone `paqad-ai graph` command is a deprecated alias that opens the dashboard on the Graph view.
- Trust gains a SIEM export panel (`GET /api/export/siem`, OCSF/ECS/CEF/JSONL), byte-identical to `paqad-ai audit export`.
- Project-scoped saved views (graph, Trust filter, SIEM export config) and access-free static HTML snapshots of receipts and modules.
- The graph leads with a clean, health-coloured map of named areas with an authored headline, reveals files and deeper detail only on zoom, and moves the engineer controls behind an Advanced disclosure.
- Plain-language node detail cards (what it is, how it is doing, what the AI changed, what to do), with the raw fields behind a For engineers disclosure.
- An AI-activity overlay projected from the verification receipts lights the areas AI agents touched, links each to its receipt, states the problem and the fix for at-risk areas, and offers a board-safe Shareable view.
