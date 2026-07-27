---
name: transition-tracing
description: Find and evidence the transitions between surfaces — where navigation actually goes, what triggers it, and the file:line that proves it — without inventing edges from mere links.
model_tier: reasoning
triggers:
  - workflow:
      - site-map
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  surfaces:
    type: path
    required: true
    description: The modeled surfaces the transitions connect (output of surface-modeling).
---

## What It Does

Adds the edges of the map: the transitions that move a user from one surface to another, each
with a trigger and a `file:line` that proves the navigation actually happens. Runs as a parallel
skill with `guard-inference` over the same modeled surfaces, then hands the graph back to the
engine to recompute reachability and dead ends.

## Use This When

Use this after modeling, alongside `guard-inference`. It only adds edges; guards are the other
skill's job.

## Inputs

- The modeled surfaces (ids, kinds, evidence).
- The navigation sinks in the code: router calls, redirects, links that are actually followed,
  handoffs, and returns.
- Read `references/transition-evidence.md` before recording an edge.

## Procedure

The graph analysis is the engine's; your job is to propose evidenced edges for it to analyze.

1. For each modeled surface, find where its code navigates: a `to` target, a `trigger`, and the
   `file:line` proving navigation occurs (a router push, a redirect, a followed link).
2. Record each transition with `to`, `trigger`, evidence, and confidence; leave guards to
   `guard-inference`.
3. Re-run `paqad-ai sitemap run` so its graph analysis recomputes reachability, dead ends, and
   dangling targets over your edges.

## Output Contract

- A JSON object `{ transitions: [{ from, to, trigger, evidence, confidence }] }`.
- Every transition carries a resolving `file:line` and a named trigger.
- Every `to` references an existing modeled surface id.

## Escalate / Stop Conditions

- Do not record a transition because a link or route string exists — only when evidence shows the
  navigation is actually performed. A stale or unreachable link is not an edge.
- Flag a `to` that references no known surface as a dangling target for the engine, do not invent
  the missing surface.
- Keep confidence honest: an inferred edge with weak evidence is `low`, not `high`.

## Resources

- `references/transition-evidence.md`
- `agents/openai.yaml`
