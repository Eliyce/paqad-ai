# Skill Runtime

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `skill-runtime`

## Purpose

Discovers and invokes the 27+ skills shipped under
`runtime/base/skills/**`. Skills are the smallest reusable unit of
agent behaviour (scope-check, spec-diff, adversarial-review, etc.).

## Source Footprint

- `src/skills`
- `runtime/base/skills`

## Features

_This module has no enumerated features in the map; the module itself is the unit of work._

## Why the code works the way it does

- **`audit-events.ts`.** A skill or pack that fails to load writes an event to
  `.paqad/skills/events.jsonl` instead of failing silently, kept apart from the module-map events.
  Each event carries a SHA-256 of the offending bytes (or of the pack path when there is no
  manifest) so the consumer can de-duplicate; a later successful load writes nothing, which lets
  the consumer clear its badge. Events with no project root, or whose write failed, wait in one
  shared in-process buffer that drops the oldest when full, because loaders are short-lived. A
  flush writes the buffer first so order is kept, and an event whose write throws goes back into
  the buffer.
- **`loader.ts`.** A SKILL.md with bad frontmatter is left out and recorded; it no longer fails the
  whole batch. Other errors, such as an unreadable file, still propagate.
- **`runtime-registry.ts`.** Runtime skills live in memory only and are lost on restart. A name
  that clashes with a built-in is refused so the built-in stays the default match. Registration
  parses and stores with no `await` in between, and `snapshot` builds a new list each call, so a
  snapshot taken earlier never changes.

## Why the shipped skill scripts work the way they do

Each skill's `SKILL.md` lists its scripts and how to call them. The scripts under
`runtime/base/skills/*/scripts/` follow one contract: lint scripts print `ok` on stdout when
clean and their issues on stderr, and exit 0 when clean, 1 when issues were found, 2 on a usage
error. The model still makes every judgment call; a script only does the deterministic part (for
example `request-classifier` fills workflow and UI, API and DB impact from keyword patterns,
while risk and scope are left to the model). The reasons below are not obvious from the code.

- **Flat criterion ids** (`acceptance-criteria-gen`, `spec-quality-review`). Only flat `AC-N`
  ids are extracted, allocated or accepted, because the spec-freeze parser reads flat ids and
  would renumber or drop a dotted `AC-N.N`. A block that passes `lint-ac-output.sh` can
  therefore never fail the freeze on shape. grep has no portable lookbehind, so the whole token is
  matched and any with a dot is dropped. A here-string, not a pipe, feeds `grep -q`, which
  avoids the SIGPIPE and `pipefail` race the script portability guard forbids.
- **Portability.** Pipelines are kept POSIX so BSD and GNU awk behave alike on macOS and Linux, and
  carriage returns are stripped so CRLF input does not break a match. YAML scalars are read
  without `yq`. `expert-notes` checks a JSON shape, so it runs in node, which paqad already
  depends on.
- **`analytics-instrumentation/scripts/instrument.mjs`.** The agent supplies only the event name
  and later the doc body; the slug, path, doc scaffold and tracking-call snippet are computed so
  casing variants cannot diverge and no path is hand-written. Providers are rows in a table, not
  branches. The `paqad-ai` package is imported only after the arguments are validated, so a
  usage error never depends on the built package resolving.
- **`decision/scripts/`.** `create.mjs` mints the `D-<ULID>` id, timestamps and JSON so a
  hand-picked sequential `D-N` id can never be minted, and `resolve.mjs` rejects any id not in
  that form.
- **Rule scripts.** `rule-analyzer/scripts/analyze.mjs` imports the compiled engine through the
  package self-reference rather than calling a CLI verb. `record-conflicts.mjs` exists because a
  deterministic reconciler cannot decide that two rules contradict; the analyzer's semantic pass
  records it as `RS-CONFLICT`. `write-map.mjs` and `register-script.mjs` write the map
  through the single-writer apply path (snapshot, atomic rename, events log). `edit-rule.mjs`
  updates the map in the same operation when one exists, so the reconciler does not report a
  false `RS-RULE-ADDED` before the next analysis, and it uses the shared `cleanRuleText` so its
  hash matches the text on disk. A script whose declared binary is missing never ran, so
  `validate-script.mjs` exits 2 (deferred, re-validate on a host that has it) instead of 1
  (rejected). `reconcile.mjs` blocks on any `RS-*` drift except `RS-CACHE-INVALID`, and
  `run.mjs` exits non-zero only in strict mode when a deterministic finding blocks the stage.
- **`module-health-update/scripts/refresh.sh`.** Always exits 0. A blocked rollup (for example a
  pack with no `module_health` block) is informational: the sync pass still runs and the
  workflow reports what it could compute. Either side of the combined report is null when its
  command printed no parseable JSON.

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
