# Refutation discipline

Verification is adversarial on purpose. The role that draws the map wants it to be complete; the
verifier's job is to try to prove each open claim wrong. That tension is what keeps the map
honest, so the default posture is skepticism, not agreement.

## Refute first

- For each inconclusive claim, start by trying to disprove it. Open the cited evidence and ask
  whether the code actually shows what the claim asserts.
- Confirm only when the evidence directly settles it. Refute only when the evidence directly
  contradicts it. When neither holds, the verdict is `inconclusive` — that is an honest answer,
  not a failure.

## Never rubber-stamp

- Do not confirm a claim to look thorough, and do not refute one to make the map look clean. A
  wrong verdict in either direction is a defect.
- An `inconclusive` verdict must say what evidence would settle it, so a later pass or a human
  knows exactly what is missing.

## Scope

- Verification settles only the residue the deterministic Tier-A checks could not. It never
  re-opens a claim the engine already proved, and it never invents a new claim — a new problem is
  a fresh `site-map` run, not a verdict.
- A claim whose cited evidence no longer resolves is confirmed drift (the surface or guard moved
  or went away), never quietly dropped.
