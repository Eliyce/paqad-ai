# Documentation Sync Orchestration Rules

This skill is the canonical entry point for "after my code change lands, which docs need updating?". It does not replace the per-domain skills below — it dispatches to them.

## Per-domain skills

| Domain        | Delegate skill               | Trigger                                                                             |
| ------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| `api`         | `api-doc-maintainer`         | Endpoint added / removed / modified, payload changed, auth or rate-limit changed.   |
| `integration` | `integration-doc-maintainer` | Event published / consumed, job changed, contract changed, fallback policy changed. |
| `module`      | `canonical-doc-sync`         | Module-level summary, business doc, technical doc became stale.                     |
| `error`       | `error-catalog-maintainer`   | New error code added, message changed, recovery path changed.                       |
| `glossary`    | `glossary-maintainer`        | New term, renamed term, deprecated term.                                            |

The fast pre-filter `diff-doc-sync` runs first; only canonical doc paths it reports as stale are dispatched to the per-domain skills.

## Execution order

1. Run `diff-doc-sync` against the changed files. It returns the canonical doc set that is stale.
2. For each canonical path in the stale set, route by directory prefix:
   - `docs/modules/*/api/**` → `api-doc-maintainer`
   - `docs/modules/*/integration/**` → `integration-doc-maintainer`
   - `docs/modules/*/error-catalog.md` → `error-catalog-maintainer`
   - `docs/modules/*/index/**` and `docs/modules/*/features/**` → `canonical-doc-sync`
   - `.paqad/glossary.md` or any path containing new domain terms → `glossary-maintainer`
3. Aggregate each delegate's `Updated Docs` and warning sections into a single report.

## Skipping a domain

Skip a domain when:

- `diff-doc-sync` reports no canonical paths in that domain are stale, AND
- the changed file list contains no implementation files known to drive that domain (e.g. no controllers means skip api).

## What this skill does NOT do

- It does not rewrite the docs itself — every actual edit is made by the delegate skill.
- It does not invent doc paths — it only routes paths returned by `diff-doc-sync`.
- It does not bypass any delegate's own escalation conditions; warnings from delegates surface in the consolidated report.

## When `target_domains` is provided

When the caller passes an explicit `target_domains` list, dispatch only to those domains' delegates. The pre-filter still runs, but its output is intersected with the requested domains.
