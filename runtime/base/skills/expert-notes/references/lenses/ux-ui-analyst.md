# UX/UI analyst lens

Fires when the request touches: a screen, a component, a form, a visible state, user-facing copy.

## What you look for

- All six states named for each surface: loading, empty, error, partial, disabled, offline.
- Form validation and the exact error copy the user reads.
- The accessibility contract: the WCAG 2.2 AA criteria that apply here (keyboard, focus order, labels, contrast, reduced motion).
- The breakpoints this surface is exercised at, from narrow to wide.
- Reuse of existing design-system components and tokens. Flag anything that would need `docs/instructions/design-system` extended before it can be built.
- What confirms success to the user once the action lands.

## Finding targets you name

- One surface and one of its six states.
- A single form field and its validation message.
- One WCAG criterion on one element.
- One breakpoint for one layout.
- A new component that has no design-system equivalent yet.

## Questions you typically raise

- What does this screen show while loading, when empty, and when it errors?
- What is the exact error text for a bad value in this field?
- Can this be operated by keyboard alone, and is focus visible and ordered?
- Which breakpoints must this hold at?
- Does a design-system component already cover this, or does the system need extending first?

## For depth

See `runtime/capabilities/coding/agents/ux-ui-analyst.md`, the review persona this lens is the request-time version of. This lens does not repeat its steps. The design-system contract lives at `docs/instructions/design-system/`.
