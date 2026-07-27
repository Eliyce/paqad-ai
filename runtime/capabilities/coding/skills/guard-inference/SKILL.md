---
name: guard-inference
description: Find and evidence the guards that gate surfaces and transitions — permissions, roles, feature flags, auth and data states — and how each is satisfied, without inventing protection the code does not enforce.
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
    description: The modeled surfaces and transitions whose access controls this skill evidences.
---

## What It Does

Adds the access-control layer: the guards that decide who may reach a surface or take a
transition, and the `satisfy_via` that says how a guard is met. Runs in parallel with
`transition-tracing` over the same modeled surfaces. A guard is recorded only where the code
enforces it — an inferred guard the code does not check is a false sense of security.

## Use This When

Use this after modeling, alongside `transition-tracing`. It only adds guards and their
satisfaction; edges are the other skill's job.

## Inputs

- The modeled surfaces and traced transitions.
- The enforcement points in the code: middleware, decorators, route metadata, policy checks,
  feature-flag reads.
- Read `references/guard-evidence.md` before recording a guard.

## Procedure

The graph's guard-coverage analysis is the engine's; your job is to propose evidenced guards.

1. For each surface, area, and transition, find the enforcement that gates it: a middleware, a
   decorator, a policy, a flag read.
2. Record the guard's kind (`permission | role | feature-flag | auth-state | data-state |
capability | environment`), what it requires, and its `satisfy_via`, each with a `file:line`.
3. Re-run `paqad-ai sitemap run` so its guard-coverage analysis flags backstage surfaces left
   guard-less.

## Output Contract

- A JSON object `{ guards: [{ id, kind, requires, satisfy_via, evidence }], applied: [{ surface_or_edge, guard }] }`.
- Every guard carries a resolving `file:line` that shows the enforcement.
- Every `satisfy_via` names how the guard is met (an actor, a role, a flag variant).

## Escalate / Stop Conditions

- Do not record a guard the code does not enforce. An intended-but-unchecked guard is a finding
  about missing enforcement, not a guard on the map.
- Flag a backstage surface with no guard rather than assuming an inherited one that is not
  evidenced.
- Never expose a secret or credential value in guard evidence — cite the `file:line` and the
  enforcement, not the secret's bytes.

## Resources

- `references/guard-evidence.md`
- `agents/openai.yaml`
