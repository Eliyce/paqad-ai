---
name: map-verification
description: Adversarially refute or confirm the claims the deterministic checks could not settle — the Tier-B pass over the site map — grounding each verdict in resolving evidence and never rubber-stamping.
model_tier: reasoning
triggers:
  - workflow:
      - site-map
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  claims:
    type: path
    required: true
    description: The machine-built table of inconclusive claims the engine's Tier-A checks could not settle.
---

## What It Does

Provides the Tier-B judgment layer: the engine's deterministic checks settle what they can and
hand over a table of claims they could not — an evidence pointer that half-resolves, a
transition whose runtime behaviour is ambiguous. This skill refutes or confirms each, grounded
in the code, so an inconclusive claim becomes either a finding or a fact — never a shrug.

## Use This When

Use this after assembly, over the engine's inconclusive-claim table. It settles only what the
deterministic checks left open; it never re-litigates a claim the engine already proved.

## Inputs

- The machine-built claim digest from the run bundle (each claim with its evidence and why it is
  inconclusive).
- The code the claims cite.
- Read `references/refutation-discipline.md` before recording a verdict.

## Procedure

The deterministic checks are the engine's; you settle only the inconclusive residue.

1. Read each inconclusive claim and open the evidence it cites.
2. Try to **refute** it first: does the code actually show what the claim asserts? Default to
   `inconclusive` when the evidence does not settle it, never to `confirmed`.
3. Record a verdict (`confirmed | refuted | inconclusive`) with the resolving `file:line`, and
   let `site-map-gap-analysis` turn confirmed problems into findings.

## Output Contract

- A JSON object `{ verdicts: [{ claim_id, verdict, evidence, rationale }] }`.
- `verdict` ∈ `confirmed | refuted | inconclusive`.
- Every `confirmed` or `refuted` verdict carries a resolving `file:line`; an `inconclusive` one
  states what evidence is missing.

## Escalate / Stop Conditions

- Default to `inconclusive` when the evidence does not settle the claim. Do not confirm to look
  thorough or refute to look clean.
- Do not invent a new claim here; new problems are a fresh `site-map` run, not a verification
  verdict.
- A claim whose evidence no longer resolves is `confirmed` drift, never quietly dropped.

## Resources

- `references/refutation-discipline.md`
- `agents/openai.yaml`
