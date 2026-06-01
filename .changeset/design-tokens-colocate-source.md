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

**`paqad refresh` no longer handles the design system at all.** The
`--design-system` flag is removed, and a bare `refresh` no longer seeds or
regenerates design-system docs/theme exports. The design system (the canonical
`design-tokens.json` and the Markdown generated from it) is owned solely by the
documentation workflow (`create documentation`). User-facing guidance that
pointed to `paqad refresh --design-system` (README, the design-system rule, the
dashboard hint) has been removed accordingly.

Note: no automatic migration of already-onboarded projects. A project whose
tokens file is still under `architecture/` should move it to `design-system/`
manually.
