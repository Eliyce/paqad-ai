# Fix Proof: Business View

> Module: **Per-Feature Evidence Bundle** (`feature-evidence`) · Layer: `framework-internals` · Feature slug: `fix-proof`

## Overview

A fix is only proven when a test fails on the old code and passes on the new code. "The tests
pass" after a fix says nothing on its own: the test may never have caught the bug. `paqad-ai fix
prove` records both halves. `red` runs the proof test before the fix lands and `green` runs it
after. paqad then reads a behaviour-changing fix as passing only when it saw red then green; any
other record reads Inconclusive, with the one step that is missing.

The technical contract lives at [`technical.md`](./technical.md) and the command surface at
[`api.md`](./api.md).

## User Roles

- **Developer**: gets a receipt that says whether the fix was really shown to work, and how to
  close the gap when it was not.
- **Agent**: runs `fix prove red` before writing the fix and `fix prove green` after it.

## User Flows

1. The change is recorded as a fix (the bug-fix classifier sets `kind: fix` on the feature record).
2. After the chief architect rules (or after `plan compile` on the fast lane), paqad asks how to
   prove the fix.
3. The agent writes or picks the proof test and runs `paqad-ai fix prove red`.
4. The agent makes the fix and runs `paqad-ai fix prove green`.
5. The receipt and the HUD show the proof state; the fix-proof gate passes on red then green.

## Business Rules

- Only a fix that can change behaviour needs proof. A change that is not a fix, or a fix that only
  touches tests, docs or paqad's own files, is "not required" and never counted against the change.
- `red` counts only when the command fails and its output names the proof test. A failure that
  does not name it is not counted as the test failing.
- A proof that passes before the fix did not reproduce the problem.
- `green` that makes the proof pass but breaks a check that passed before is held.
- Anything other than red then green on a behaviour-changing fix reads **Inconclusive**, never a
  pass, with the next step named.

## Triggers and Side Effects

- Runs the given command in the project root, then appends one row to the bundle's
  `fix-proof.json`.

## Error States

- No active change, an unknown phase or a bad `--timeout`: exit 1, nothing recorded.
- A command that cannot start, times out or uses shell syntax paqad does not run: the row is
  recorded with outcome `error` and the command exits 1.

## Glossary

- *red*: the proof test fails before the fix.
- *green*: the proof test passes after the fix.
- *held*: the proof passes but the fix broke something that passed before.
