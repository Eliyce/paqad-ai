# Journey shape

A journey is a claim that a real actor takes a real path to a real goal. Its value comes from
being _few and important_ — a handful of load-bearing journeys a newcomer can follow, not an
exhaustive enumeration of every click. This reference is the shape and the discipline.

## The well-formed journey

- **One actor, one goal.** A journey with two goals is two journeys. Name the actor and the single
  outcome it pursues.
- **An entry.** Where the actor starts — a landing surface, a deep link, a command.
- **Ordered steps.** Each step is a surface + an action + an expectation ("on the checkout screen,
  submit payment, expect the confirmation"). Every step references a surface the map already
  proved.
- **Branches.** The meaningful forks (guest vs signed-in, valid vs declined), each pointing at
  existing surfaces.
- **Dual ends.** Both the success end and the failure end. A journey with only a happy path is
  incomplete — the failure end is where real apps live.

## The cap, and why

Propose at most the configured cap. The arc42 discipline is deliberate: ten journeys that carry
the product's real value teach a newcomer the app; a hundred trivial ones bury the signal. When
you are over the cap, drop the least load-bearing candidates and record why — do not pad.

## What matters (the signals)

Let evidence decide which paths are important: a path exercised by tests, one that shows up in
analytics, one the README walks a user through. A journey with no such signal is a guess; say so
in its evidence, or leave it out.

## The confirmation line

Every synthesized journey is `proposed`. A journey becomes `confirmed` only when a human signs off
through the audited surface. Never self-confirm, never lower a status to force a journey through,
and never touch the surface/transition/guard graph layers — those belong to the app-cartographer.
