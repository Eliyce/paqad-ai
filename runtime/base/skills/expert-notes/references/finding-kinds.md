# Finding kinds

A lens returns findings. Each finding is a small, self-contained object:

```
{ target, claim, kind, severity, evidence? }
```

- `target` is the one concrete thing the finding is about: a table, a column, an endpoint, a screen, a step, a field.
- `claim` is the one thing the finding says about that target.
- `kind` says what the claim becomes downstream.
- `severity` says how hard the claim pushes.
- `evidence` is optional grounding: a path, a symbol, a doc line.

## kind

Each finding is exactly one of these:

- `requirement` becomes a functional or non-functional requirement (an FR or NFR).
- `invariant` becomes an INV, a rule that must always hold.
- `acceptance` becomes an acceptance criterion (an AC).
- `risk` becomes an NFR or a failure-path AC.
- `non-goal` becomes a Non-goals line.

## severity

Each finding is exactly one of these:

- `must` means the spec is wrong without it.
- `should` means strongly expected, though a reason could set it aside.
- `could` means worth noting and safe to defer.

## One target, one claim

A finding is about ONE concrete target and makes ONE claim. If you want to say two things, write two findings. This keeps the chief architect's job simple: accept or decline one clear statement at a time.

## Empty is fine

A lens may return no findings. That means the expert looked and had nothing to add. It is a valid, cheap outcome, not a failure. Do not pad a note to look busy.
