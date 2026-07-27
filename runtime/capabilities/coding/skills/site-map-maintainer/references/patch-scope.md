# Patch scope

The maintainer keeps the map alive without turning every code change into a full re-map. Its
discipline is scope: touch only the surfaces the diff actually drifted, and prove each patch from
the changed files.

## What counts as flow-relevant

A changed file is flow-relevant when it is one the map cites (a surface's evidence file) or it
declares navigation or access: a route, a command program, an endpoint handler, a guard
(middleware, decorator, policy, flag read). A change to none of these does not drift the map, and
the maintainer stays out of the way.

## Scoped patch, not a re-map

- Add a surface for a newly declared route or command; update the guard on a surface whose
  enforcement changed; mark a surface removed when its declaration is gone.
- Leave every surface the change did not touch exactly as curated. A scoped change that rewrites
  unrelated map entries is the bug the maintainer exists to prevent.

## Prove every patch

- Each patched surface carries resolving evidence from the changed files. A patch with no
  `file:line` from the diff is a guess, not a maintenance edit.

## Removals are decisions

- When a change removes a surface that a journey still references, that is not a silent deletion.
  Surface it for a human decision — the journey may need updating, or the removal may be a
  mistake. The map never quietly loses a surface a journey depends on.
