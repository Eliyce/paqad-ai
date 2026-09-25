# Spec Pipeline & Experts

> **Layer:** `agent-workflows` &nbsp;·&nbsp; **Slug:** `spec-pipeline-and-experts` &nbsp;·&nbsp; **Issue:** #547

## What it is

When the pipeline is on, paqad does not jump from a ticket to a hand-written spec. It runs a fixed set of steps that read the request, pull in the right specialists, ask you only what nobody else can answer, and write a spec in the exact format the freeze accepts. Every line in that spec can be traced back to where it came from, and the run records what it cost and what it changed.

The result is a frozen spec you can trust, plus a paper trail that says who was consulted and why the spec says what it says.

## What a run looks like from your seat

You paste a ticket URL (say, "Let customers download their invoices as CSV"). Before any code is written:

<details>
<summary><strong>The nine steps of a real run</strong></summary>

1. **Route.** The router reads the ticket, routes to feature-development, opens the change, and (because the pipeline is on) the specification stage says: run the pipeline.
2. **Start.** `paqad-ai spec pipeline start` fetches the ticket, writes the request text, grounds it in the project's own docs, and rates how clear the request is. Zero model tokens.
3. **Pick the experts.** The right specialists are chosen for this request: a database expert if it touches data, a security expert if it touches who can do what, a UI expert if it touches a screen, and so on. Eleven pickable experts exist, and a chief architect always runs once any expert fired.
4. **Take notes.** Each expert writes short notes: what this request must do, what it must never break, what is still undecided, plus any plain-language questions.
5. **Synthesise.** The chief architect reads all the notes, accepts or declines each one with a reason, recommends how to settle any disagreement between two experts (a recommendation, never applied, it becomes a decision you make), lists what nobody covered, and gives a readiness verdict.
6. **Ask you.** You get one small batch of plain-language questions, only for the things nobody can answer from the project's own docs. Answers are phrased as outcomes, in your own words. A question the project already answered before is answered for you.
7. **Write the spec.** The spec is written in the exact format the freeze accepts, with every line traced back to where it came from (the request, an answer, or an expert finding).
8. **Freeze.** The spec is frozen. The readable spec ends with a Provenance section: pipeline-produced, which experts were consulted, what they found, and how any disagreements were settled.
9. **Receipt.** The end-of-change receipt names which experts were brought in and whether their notes changed the spec.

</details>

## The two flags

Two flags gate all of this.

- With the **experts flag off**, steps 3 to 5 do not happen. The pipeline still grounds the request, asks its questions, and writes a traced spec, just without the specialist notes.
- With the **whole pipeline off**, none of it happens and the change proceeds exactly as it did before.

Onboarded projects start with both flags off. This repo runs everything on.

## Adoption: how strict the freeze is

- Under **strict** adoption, a hand-written spec is refused at freeze. The only exit is a recorded manual reason, so the skip is on the record, not silent.
- Under **warn** adoption (the default), a hand-written spec still freezes, and the record says it was written by hand.

## Why it matters

Requirements are where the expensive mistakes hide. Bringing the right specialists in before code, asking only the questions that matter, and tracing every line back to its source removes rework before a keystroke. Every run also records what it cost and what it changed, so the experts prove their worth over time rather than being taken on faith.

## Boundaries

This feature owns the pipeline steps, the expert roster, and the run record it keeps in the change's evidence bundle. It hands a freezable spec to the freeze gate and the "done" bar ([spec-and-done-bar](../spec-and-done-bar/business.md)); it does not run the proofs, slice the spec, or build the spec↔code↔test map. Those consume the spec this pipeline produces.
