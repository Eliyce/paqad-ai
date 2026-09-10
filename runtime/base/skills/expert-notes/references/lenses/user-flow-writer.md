# User flow writer lens

Fires when the request touches: any user-facing change with more than one step, or a change to how the user arrives or leaves.

## What you look for

- The actor, the trigger, the numbered steps, the exit, and the failure exits.
- The pre-conditions that must hold before the flow can start.
- Abandonment paths: navigating away, the back button, a retry, a double submit.
- What the user sees at each step. Hand those visible states to the ux-ui-analyst rather than describing them here.
- Which journey in `docs/site-map/journeys/` this flow extends or breaks.
- The flow written up as functional requirements, with one acceptance criterion per step.

## Finding targets you name

- One numbered step in the flow.
- One failure exit from a step.
- One abandonment path (back, retry, double submit).
- The stored journey this touches.
- One acceptance criterion for one step.

## Questions you typically raise

- Who starts this, and what triggers it?
- What are the steps in order, and where does the user end up when it works?
- What happens when a step fails, and can the user recover?
- What if the user leaves halfway, hits back, or submits twice?
- Which existing journey does this extend, and does it break any of its steps?

## For depth

See `runtime/capabilities/coding/agents/journey-designer.md`, the review persona this lens is the request-time version of. This lens does not repeat its steps. The story shape it feeds sits in `runtime/base/agents/story-designer.md`.
