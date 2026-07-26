# Installed Framework-API Index

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `framework-api`

## Purpose

The deterministic backend that verifies framework reuse claims (issue #397).

[#357](../../feature-evidence/index/summary.md) lets a plan **declare** it is reusing a
framework API — "I'll use React's `useId()` instead of hand-rolling one". Nothing
**checked** that claim: `provenance` was model-declared, and the only cross-check was that
the package's *version* appeared in `.paqad/stack-snapshot.json`. This module answers the
two questions that actually matter, for the version actually installed:

- does the symbol **exist**?
- does it carry a static **`@deprecated`** marker?

Both answers come from the declaration files that physically ship inside the installed
package. **Zero model tokens**, and the only network call in the whole module is the
Laravel Upgrade Guide backstop described below. It is the framework-native counterpart to
what the code-knowledge index (#353) did for first-party symbols — which is first-party
only by design, since it hard-excludes `node_modules` and `vendor`.

Four ecosystems are covered (issue #398). Each runs the same three steps against a
different declaration layer:

| Ecosystem | Installed version from | Existence + deprecation from |
| --- | --- | --- |
| JS/TS (`node`) | `node_modules/<pkg>/package.json` | the shipped `.d.ts` / `@types` declarations, walked with the TypeScript compiler |
| PHP (`php`) | `vendor/composer/installed.json`, then `composer.lock` | `vendor/` source: `#[\Deprecated]`, then `@deprecated`, then `trigger_error(E_USER_DEPRECATED)` |
| Python (`python`) | `<site-packages>/<dist>-<ver>.dist-info/METADATA` | `__all__` + module-level declarations (a `.pyi` stub wins): PEP 702 `@deprecated`, then `DeprecationWarning` |
| Java/JVM (`jvm`) | the jar's `META-INF/maven/**/pom.properties` | jar class entries: the `Deprecated` attribute and the `RuntimeVisibleAnnotations` entry for `@Deprecated` |

`go`, `rust` and `dart` are deliberately unregistered: an ecosystem with no adapter records
`no-adapter` rather than being run through the wrong reader.

## Shape

`.paqad/indexes/framework-api.json`, one entry per installed framework keyed by
`package@resolvedVersion`:

```jsonc
{
  "package": "react", "version": "19.2.6", "ecosystem": "node", "root": ".",
  "content_hash": "sha256:…", "sources": ["graph-ui/node_modules/@types/react/index.d.ts"],
  "symbols": [
    { "name": "useId", "kind": "function", "exists": true, "deprecated": false,
      "message": null, "since": null, "for_removal": false, "provenance": "asserted" }
  ]
}
```

Every framework that produced no entry is recorded in `blocked` with a reason
(`no-adapter`, `not-installed`, `no-types`, `parser-unavailable`). A silently missing
package would read as "checked and fine", which is the failure this index exists to
prevent.

## Files

- **Types** (`types.ts`) — the normalized record, the per-package entry, the index
  envelope, and the `FrameworkApiAdapter` interface every ecosystem implements.
- **Schema + store** (`schema.ts`, `store.ts`) — a committed AJV schema in
  `src/validators/schemas/framework-api.schema.json` plus an atomic temp+rename write and a
  tolerant read, mirroring `src/code-knowledge/store.ts`. A missing, corrupt, or
  schema-invalid file reads as absent, never as a half-built index.
- **Resolved-version reader** (`resolve-version.ts`) — reads the version from
  `node_modules/<pkg>/package.json`, **not** from the snapshot's `locked_version`, which
  mirrors the manifest range (`^19.0.0`) rather than a resolved pin. Also resolves the
  declaration entry through `types`/`typings`, the `exports` condition tree, a conventional
  `index.d.ts`, and finally the `@types/<pkg>` companion (`react` itself ships no
  declarations; `@types/react` does).
- **TypeScript loader** (`typescript-loader.ts`) — lazily resolves the compiler from the
  onboarded project first, then paqad-ai's own install. See the dependency decision below.
- **Node adapter** (`adapters/node.ts`) — walks the declaration graph with the compiler
  API, following `export *` barrels, `declare namespace` + `export =`, and one level of
  class/interface members. Existence is whether the exported symbol resolves; deprecation
  is `getJsDocTags()` carrying `@deprecated`.
- **Shared adapter primitives** (`adapters/shared.ts`) — the wildcard contract
  (`DYNAMIC_MEMBER_SUFFIX`, `dynamicRecord`), the posix path helper, and the segment-aware
  name split that understands `.`, `::` and `\`. One definition, so "never claim absence you
  cannot prove" cannot diverge between ecosystems.
- **PHP adapter** (`adapters/php.ts`, `adapters/php-scan.ts`) — reads composer's installed
  manifest and the `vendor/` declarations. A facade's members come from its
  `@method static … name(...)` docblocks, which Laravel writes precisely for tooling, so
  `Cache::get` resolves instead of reporting only `__callStatic`.
- **Python adapter** (`adapters/python.ts`) — reads the dist-info METADATA and the module's
  own declarations, preferring a `.pyi` stub when one ships.
- **JVM adapter** (`adapters/jvm.ts`, `adapters/jar.ts`, `adapters/class-file.ts`) — locates
  the artifact in the developer's Maven repository or Gradle module cache (the one ecosystem
  whose install tree is not inside the project), then reads the jar's zip directory and the
  class files' constant pools. A Spring `*-starter-*` ships no classes, so a starter is
  followed through its sibling POM to the modules it aggregates.
- **Adapter registry** (`adapters/registry.ts`) — modelled on `EcosystemParserRegistry`.
  `node`, `php`, `python` and `jvm` are registered; `go`, `rust` and `dart` are not.
- **Builder** (`builder.ts`) — selects packages by crossing the stack snapshot with the
  shared `FRAMEWORK_PACKAGE_MAP`, honours each dependency's `root` (this very repo installs
  react under `graph-ui/`, not at the top), and content-addresses each entry so a rebuild at
  unchanged versions is a cache hit.
- **Query** (`query.ts`) — the single place a verdict is decided, so the CLI and
  `plan compile` can never disagree. Reuses the exported `levenshtein` for nearest-match
  rather than adding a second edit-distance implementation.

## Verdicts

| Verdict | Meaning | Effect on `plan compile` |
| --- | --- | --- |
| `live` | Resolved; no static deprecation marker | compiles |
| `deprecated` | Resolved; carries `@deprecated` | **blocks**, citing the message and `since` |
| `absent` | Package resolved, symbol demonstrably not exported | **blocks**, suggesting the nearest symbol |
| `unknown-dynamic` | Provided at runtime, or not individually enumerated | warns |
| `package-not-indexed` | The index has no entry for this package | warns |

Only the two middle rows block. Everything the index could not resolve warns, because a
false "absent" hard-blocks a perfectly good plan.

## What it stores, and why

Top-level exports are enumerated in full, so a missing one is a real `absent`. Members are
stored **only when deprecated**, and every container carries a `<Container>.*` wildcard
marked `unknown-dynamic`, so a member the index does not list warns instead of blocking.
Measured on this repo: 676 records instead of 18,574 (192K instead of 4.9MB), with the
same 299 deprecations found, and no case where "not listed" becomes "does not exist".

## Coverage limit — state this, do not imply otherwise

`deprecated: false` means **"no static deprecation marker was found"**, not "this API is
live". Verified counter-examples: `react-dom`'s `render`/`hydrate` deprecation is a runtime
`console.warn`, not a `.d.ts` tag, and a real Laravel **v13.18.0** install carries 39
`@deprecated` docblocks and **zero** `#[\Deprecated]` attributes across the whole framework.
That is why the verdicts are tiered and why nothing here ever reports a confident "not
deprecated".

## The Laravel Upgrade Guide backstop (D-01KYEQSEE1YV11T9VN9M2AKME7)

Because Laravel's authoritative deprecation record is prose, not tags, the version-pinned
Upgrade Guide is fetched for the installed major, cached, and parsed
(`laravel-upgrade-guide.ts`). A symbol the guide deprecates that the code never tagged is
recorded `deprecated: true` with `provenance: "doc-derived"`; a real `@deprecated` tag is
never overwritten by prose, because a declaration says more than a guide does.

This is the **one** place the index reaches the network, and #397's zero-network invariant
is amended for it by the decision above. It is fenced so nothing else changes:

- it runs as a **post-pass** on the built index, so the builder and every adapter stay
  synchronous and offline;
- the guide is cached under `.paqad/indexes/cache/` and re-fetched at most weekly;
- `--offline` skips the network and uses only what is cached;
- a failed or skipped fetch adds **no** records rather than failing the build.

What it finds is honestly variable, because the guides vary: measured against the real
published guides, 11.x yields 19 records, 12.x yields 4, and 13.x yields 0 — the 13.x guide
names almost nothing by `Class::method`.

## Dependency decision (D-01KYCFNW46E4AZC9JAAH5ZCR9P)

`typescript` is an **optional peer dependency**, never a runtime one. paqad-ai installs
into onboarded projects of any stack — Laravel, Flutter, Python — and none of them should
pay 24MB for a JS-only verifier. `peerDependenciesMeta.typescript.optional` stops npm
auto-installing it, and `loadTypeScript` resolves it lazily.

The degradation is self-correlating rather than arbitrary: a JS/TS project without
`typescript` installed also has no `@types/*` on disk, so "no parser" and "nothing to
index" coincide. When neither hop resolves, the package is recorded `parser-unavailable`
and `plan compile` falls through to its documented warning.

A hand-rolled `.d.ts` scanner was rejected for a verified reason: `@types/react` puts its
whole surface inside `declare namespace React` behind `export = React`
(`index.d.ts:67,70`), so a naive export scan misses `useId` entirely and would report a
false "absent".

## CLI

```bash
paqad-ai index framework-api build [--force] [--offline] [--quiet]
paqad-ai index framework-api query <package> <symbol>
```

`query` exits `1` for `absent` or `deprecated`, and `2` when no index has been built.
`--offline` skips the Laravel Upgrade Guide fetch.

A symbol can be claimed in any spelling its ecosystem uses: `Cache::get`, `Cache.get` and
`Illuminate\Support\Facades\Cache::get` all answer from the one stored record, because the
name match compares last segments across `.`, `::` and `\`.

## Boundaries

- **Not** package-level deprecation ("is this whole package EOL?") — that is the health
  workflow's `detectDeprecatedDependencies`, a different altitude.
- **Not** semantic duplicate detection ("is my helper a rewrite of the framework's?") —
  that is the duplication gate (#358).
- **Not** proactively surfacing candidate framework APIs before planning — a digest concern.
