---
'paqad-ai': minor
---

Give the dashboard the seven-area management IA and the comprehension layer (#146 phase 3, first slice).

The dashboard now opens on Pulse and organizes everything the spec's
management rule describes into seven areas behind a quiet, collapsible left
sidebar: Pulse, Approvals, Trust, Build, Automation, Knowledge, Setup. The
legacy all-sections health view stays reachable at `#/dashboard` and the
architecture graph keeps `#/graph`, reached from Build.

A new `GET /api/inventory` endpoint classifies every paqad functionality
exactly once as web-managed, prompt-managed, evidence, or a safe operation,
with its owner, live on-disk state, and the area page that renders it. Area
pages draw their cards entirely from this report, so the three-way
classification lives in one place.

The comprehension layer ships with it: an ownership badge on every card (You
manage this, Paqad manages this, Shared), a why-sentence under every title, a
"Why this matters" drawer with the problem, the benefit, and what happens
without it, and empty states that teach. All copy follows the spec's voice
pack verbatim.
