---
'paqad-ai': minor
---

Overhaul the rule packs shipped into onboarded projects, and add
`paqad-ai refresh --rules` to regenerate them (issue #94).

**Why.** An audit of every rule under `runtime/**/rules/**` found four problems:
factually wrong / hallucinated rules (the Laravel `boost.md` invented a "Boost
module system" that does not exist; two Axum/serde claims in `rust-web` security
were wrong), rules that duplicated the per-project `module-map.yml`, framework
plumbing leaking into projects (`.paqad/` paths, phases, lanes, cache metrics),
and large amounts of non-actionable platitude ("keep X aligned; document when it
changes").

**What changed.**

- **Correctness.** `boost.md` now describes the real Laravel Boost MCP server
  (tools, guidelines, docs API) instead of a fabricated module system. The two
  wrong `rust-web/security` lines are fixed (auth via a `tower` layer / a
  `FromRequestParts` extractor; `#[serde(skip)]` for never-serialized fields).
- **Every stack rewritten.** All stack and capability rule packs (laravel,
  react, vue, flutter, go-web, rust-web, angular, astro, django, dotnet,
  express, fastapi, flask, nestjs, nextjs, rails, spring-boot, svelte,
  kotlin-android, and the framework/meta-framework capabilities) were rewritten
  to be concrete, framework-accurate, and checkable against a diff. Version-stale
  APIs were corrected (e.g. Tailwind v4 `@theme`/`@source`, Inertia v2
  `optional`/`defer`).
- **No more `module-map.yml` duplication.** `architecture.md`/`modules.md` now
  point to `docs/instructions/rules/module-map.yml` as the source of truth for
  module ownership instead of restating generic boundary advice.
- **No framework footprint.** Base and `_shared` rules no longer reference
  `.paqad/`, phases, lanes, handoff, or cache/context metrics; a project can
  delete `.paqad/` with no dangling rule references.
- **New command.** `paqad-ai refresh --rules` re-resolves the framework rule
  packs for the project's saved stack and rewrites `docs/instructions/rules/`.
  Without `--force` it reports the plan (what would be deleted/written) and makes
  no changes; with `--force` it deletes the previously generated rules and
  rewrites them, preserving the project-owned `module-map.yml` and
  `rule-script-map.yml`.
- **Guards.** A new `tests/unit/content/rule-quality.test.ts` rejects rule files
  that contain workflow markers (`## Trigger`, `### Step`, `run_id`) or `.paqad/`
  references, so these regressions are blocked. `runtime/rules-authoring.md`
  documents the contract.

Note: the `design-test`/`design-retest`/`pentest` workflow specs still live under
`rules/` (the onboarding contract and tests depend on them as generated files);
relocating them out of the copied rule set is tracked as follow-up and they are
allowlisted in the guard for now.
