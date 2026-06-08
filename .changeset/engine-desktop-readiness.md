---
'paqad-ai': minor
---

Engine surface buildout for the desktop app (PQD Engine tickets):

- PQD-92 (seq 24): Author the engine extension surface contract
- PQD-95 (seq 27): Set up a project profile and `.paqad/` schema versioning baseline
- PQD-96 (seq 28): Set up structured logging and log-redaction rules across the three runtimes
- PQD-98 (seq 29): Hot-register a skill in memory at runtime without restarting
- PQD-99 (seq 30): Subscribe to engine events through a single unified stream
- PQD-100 (seq 31): Stream slice execution events so consumers can render progress live
- PQD-101 (seq 32): Stream decision pause events so consumers can pop the packet UI live
- PQD-102 (seq 33): Accept extracted text from a vision call into the retrieval index
- PQD-103 (seq 34): Preview the onboarding file tree without writing anything to disk
- PQD-104 (seq 35): Cancel every long-running engine call from the consumer side
- PQD-105 (seq 36): Plug a consumer logger into the engine so all engine logs surface in the consumer
- PQD-106 (seq 37): Report the engine version and the minimum consumer version it supports
- PQD-107 (seq 38): Surface a stable error taxonomy that consumers can route to UI behaviours
- PQD-167 (seq 98): Compute the per-turn context budget breakdown for the active model
- PQD-169 (seq 100): Generate a rolling summary that preserves speaker attribution
- PQD-171 (seq 102): Rebuild the API conversation deterministically per turn
- PQD-172 (seq 103): Tag turn priority and protect decision-packet turns from collapse
