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
package. **Zero model tokens, zero network.** It is the framework-native counterpart to
what the code-knowledge index (#353) did for first-party symbols — which is first-party
only by design, since it hard-excludes `node_modules` and `vendor`.

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
- **Adapter registry** (`adapters/registry.ts`) — modelled on `EcosystemParserRegistry`.
  Only `node` is registered; PHP, Python, and JVM are #398 and drop in here.
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
`console.warn`, not a `.d.ts` tag, and Laravel 10.x `Str.php` carries **zero**
`@deprecated` docblocks (its record is the version-pinned Upgrade Guide). That is why the
verdicts are tiered and why nothing here ever reports a confident "not deprecated".

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
paqad-ai index framework-api build [--force] [--quiet]
paqad-ai index framework-api query <package> <symbol>
```

`query` exits `1` for `absent` or `deprecated`, and `2` when no index has been built.

## Boundaries

- **Not** package-level deprecation ("is this whole package EOL?") — that is the health
  workflow's `detectDeprecatedDependencies`, a different altitude.
- **Not** semantic duplicate detection ("is my helper a rewrite of the framework's?") —
  that is the duplication gate (#358).
- **Not** proactively surfacing candidate framework APIs before planning — a digest concern.
