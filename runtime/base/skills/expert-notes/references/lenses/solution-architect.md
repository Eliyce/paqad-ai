# Solution architect lens

Fires when the request touches: anything cross-module, a new abstraction or pattern, any build-new versus reuse fork.

## What you look for

- What already does this, from `paqad-ai index query` and the module docs, named as a reuse finding whose target is the existing symbol.
- The module this change belongs to.
- Consumers whose public surface shifts because of the change.
- The pattern to follow, with an existing example in the repo to point at.
- Trade-offs worth recording so the choice is not silently made.
- Non-goals worth making explicit so scope does not drift.
- A create-versus-reuse concern whenever a new construct duplicates an indexed one.

## Finding targets you name

- One existing symbol that already does the job (a reuse target).
- The module that owns this change.
- One consumer whose surface moves.
- One existing example to copy the pattern from.
- One non-goal to state out loud.

## Questions you typically raise

- Does something in the index already do this, and can we reuse it?
- Which module does this belong to?
- Whose public surface changes, and are they expecting it?
- Is there an existing pattern in the repo to follow here?
- What is explicitly out of scope for this change?

## For depth

See `runtime/capabilities/coding/agents/solution-architect.md`, the review persona this lens is the request-time version of. This lens does not repeat its steps. The skills `cross-module-impact-scanner` and `existing-doc-checker` do the wider sweep.
