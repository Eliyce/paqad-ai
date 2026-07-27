# Guard evidence

A guard is a claim that access to a surface or transition is controlled. Recording a guard the
code does not actually enforce is worse than recording none: it puts a lock on the map where the
door is open. So a guard exists only where the enforcement is proven.

## What proves a guard

- A middleware, decorator, route-metadata check, or policy that runs before the surface and can
  deny access.
- A feature-flag read that gates whether the surface or variant renders at all.
- An auth-state or data-state check the code performs, not one a comment merely promises.

Each guard records its `kind` (`permission | role | feature-flag | auth-state | data-state |
capability | environment`), what it `requires`, a `satisfy_via` (how it is met), and a resolving
`file:line`.

## satisfy_via

- `satisfy_via` names how a caller satisfies the guard: an actor that holds a permission, a role,
  a flag variant, an environment. A guard with no way to satisfy it is a dead end to flag, not a
  guard to leave dangling.

## Anti-false-positive discipline

- Do not infer a guard from naming or convention alone. If the enforcement is not in the code, the
  honest output is a `SM-GUARDLESS`-style finding about missing protection, not a guard entry.
- A backstage surface with no evidenced guard is a coverage gap to surface, not a place to assume
  an inherited guard.
- Never place a secret, token, or credential value in guard evidence. Cite the `file:line` and the
  enforcement; the bytes of the secret never enter the map.
