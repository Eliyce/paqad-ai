---
'paqad-ai': minor
---

Complete the dashboard editing surface: every web-managed setting is editable on the web (#146 phase 3).

New editors, all through the audited write pipeline: the instructions
editor in Knowledge (file tree, CodeMirror with frontmatter as fields,
markdown preview, the 409 diff prompt), the module map editor in Build
(structured table, raw YAML editor of record, drift findings inline with
one-click reconcile), the design token editor (swatch grid, raw JSON, live
preview, derived docs regenerated on save), the profile schema form,
capability toggles, pack install and remove, the decision pause contract,
and the RAG settings panel.

Safe operations run as jobs through the same code paths as the CLI:
reconcile, refresh rules, refresh context, rebuild or clear the RAG index,
regenerate design docs, compliance check, and doctor. Progress streams over
SSE as `ops-progress`, double-starts of the same action answer 409, and
every finished job lands in the audit log.

Also new: `GET /api/audit` (the filterable audit feed),
`GET /api/onboarding-checklist` (real-event completion states), and
`GET /api/export/evidence-packet` (a self-contained HTML, Markdown, and
JSON trust bundle).
