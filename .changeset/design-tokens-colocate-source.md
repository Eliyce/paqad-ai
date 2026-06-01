---
'paqad-ai': patch
---

Relocate the design-system source of truth and label generated outputs (issue
#92). The canonical, hand-edited `design-tokens.json` now lives at
`docs/instructions/design-system/design-tokens.json` — co-located with the
Markdown it produces — instead of under `docs/instructions/architecture/`. Each
generated file (`tokens.md`, `components.md`, `motion.md`, `accessibility.md`,
`responsive.md`, `patterns.md`) now carries a `GENERATED … do not edit` banner
pointing back at the source, and the seeded JSON carries a `$comment` declaring
it the canonical source. This makes it obvious on disk which file to edit and
which are outputs.

Note: no automatic migration of already-onboarded projects. A project whose
tokens file is still under `architecture/` should move it to `design-system/`
manually; otherwise the next `create documentation` / `paqad refresh` will seed
a fresh default file at the new location.
