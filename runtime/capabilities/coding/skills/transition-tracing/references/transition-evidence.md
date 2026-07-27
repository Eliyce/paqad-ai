# Transition evidence

A transition is a claim that a user moves from one surface to another. The map is only as
trustworthy as this claim, so an edge exists only when the code proves the navigation happens —
not when a link merely appears in the source.

## What proves a transition

- A router push, `navigate`, redirect, or equivalent that transfers control to the target surface.
- A followed link whose handler actually performs the navigation, not a bare `href` string that
  may be dead.
- A handoff or return between flows, with the `carries`/`returns` payload where the code shows it.

Each transition records `to` (an existing surface id), `trigger` (what causes it), a resolving
`file:line`, and a confidence.

## The link-is-not-an-edge rule

The single most common false positive is treating the presence of a link or route constant as a
transition. It is not. A URL in a config, a commented-out route, or a link to a surface that no
longer exists is not navigation. Record the edge only when the evidence shows the move is
performed at runtime.

## Confidence and dangling targets

- An edge whose evidence directly shows the navigation is `high`. An edge inferred from a weaker
  signal is `low`; say so rather than inflating it.
- A `to` that points at no known surface is a dangling target — hand it to the engine as a
  cross-reference finding. Do not invent the missing surface to make the edge resolve.
