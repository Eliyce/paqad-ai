---
'paqad-ai': minor
---

Add the audited write pipeline and the first full web editor: the delivery policy rule builder (#146 phase 3).

Every dashboard file mutation now runs one pipeline: validate (ajv for
schema-backed files, YAML parse otherwise), enforce the path allowlist (only
`docs/instructions/**` and the named config files; no traversal, no
dotfiles, symlinks resolved and rejected outside the project root), check
the content hash the client loaded (a mismatch returns 409 with the current
content for a side-by-side diff), write atomically, and append
`actor="dashboard"` with the content hash to `.paqad/audit.log`. Edits under
`docs/instructions/**` invalidate the agent entry sentinel through the
existing mtime gates, so every agent reloads the canonical context next
session.

The delivery policy gets the spec's rule builder at `#/delivery-policy`:
one card per process section with a "Paqad keeps this in sync" / "You own
this" toggle, typed fields, and a plain-language preview line under each
section. A raw YAML mode covers everything else, and structured edits go
through a YAML document so comments survive. Saving validates against the
delivery-policy schema and answers with the win line. The instructions file
tree and file read/write endpoints land server-side for the Knowledge
editor that follows.

New endpoints: `GET/PUT /api/config/delivery-policy`,
`GET /api/files/instructions`, `GET/PUT /api/files/instructions/{path}`.
All mutations sit behind the existing guardrails, including `--read-only`.
