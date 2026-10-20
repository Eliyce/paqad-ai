# Template Engine

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `template-engine`

## Purpose

Handlebars templates for spec documents, user flows, registry pages,
sequence plans, phase handoffs, adversarial review reports, and
design-system docs.

## Source Footprint

- `src/templates`
- `runtime/templates`
- `src/design-tokens`

## Features

_This module has no enumerated features in the map; the module itself is the unit of work._

## Why the `src/design-tokens/` code works the way it does

`seed()` writes a neutral, schema-valid scaffold, never invented brand colours or fonts. Its
`$comment` key marks the file as the unedited placeholder, and the documentation workflow refuses
to build design-system docs while it is there (`DesignTokensPlaceholderError`), because docs built
from generic values would describe a design system that does not exist. Deleting the `$comment`
and filling in real tokens unlocks generation. `# Template Engine

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `template-engine`

## Purpose

Handlebars templates for spec documents, user flows, registry pages,
sequence plans, phase handoffs, adversarial review reports, and
design-system docs.

## Source Footprint

- `src/templates`
- `runtime/templates`
- `src/design-tokens`

## Features

_This module has no enumerated features in the map; the module itself is the unit of work._

-prefixed keys are metadata and never appear in
generated output. Every generated design-system file starts with a header saying it is an output,
so it is clear which file is the editable source.

## Authority

The single source of truth for this module's identity, slug, feature names, and source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml). If anything
in this page disagrees with the map, the **map wins** — update the map first, then regenerate this
page via `create module documentation`.

## How to Update These Docs

1. Edit `docs/instructions/rules/module-map.yml` if the module or feature names changed.
2. Run `create module documentation` in your AI agent (Claude Code, Codex, Cursor, …).
3. Review the regenerated business + technical pages per feature.

## Related

- Module registry: [`docs/instructions/registries/modules.md`](../../../instructions/registries/modules.md)
- Stack overview: [`docs/instructions/stack/overview.md`](../../../instructions/stack/overview.md)
- Architecture overview: [`docs/instructions/architecture/overview.md`](../../../instructions/architecture/overview.md)
