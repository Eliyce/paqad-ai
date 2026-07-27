# Finding composition

A gap finding is a promise: the map has a problem here, this is the proof, and this is how to fix
it. A finding that fails any of those three is noise. This reference is the bar.

## Where findings come from

- The engine's graph invariants: unreachable surfaces (`SM-ORPHAN`), navigational dead ends
  (`SM-DEADEND`), guard-less backstage surfaces (`SM-GUARDLESS`), broken cross-references
  (`SM-XREF`), and removed or stale evidence (`SM-REMOVE`, `SM-EVIDENCE`).
- The `SM-ADD` reconciliation: an extracted surface the committed map does not cover.
- The confirmed Tier-B verdicts from `map-verification`.

You never invent a finding from a fresh reading of the code — the finding must trace to an
invariant or a confirmed verdict.

## Identity and vocabulary

- The id is a content-addressed `SM-<hash8>`, stable across runs so `site-map-retest` can replay
  it. Reuse `finding-normalizer` so ids, severities, and statuses follow the shared vocabulary.
- The category is a field, not the id: `SM-ADD | SM-REMOVE | SM-EDGE-STALE | SM-GUARD-DRIFT |
SM-ORPHAN | SM-DEADEND | SM-XREF | SM-GUARDLESS | …`.

## Every finding carries a concrete fix

- The `suggestion` names the exact remediation: model the surface, add the guard, remove the stale
  edge, ground the citation, map the extracted surface. "Investigate this" is not a fix.
- Order findings by severity so the receipt leads with what matters.

## Secrets

- A finding that touches a guard or credential cites `file:line`, rule, and fingerprint only. The
  bytes of a secret never enter a finding.
