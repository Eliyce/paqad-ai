---
name: edge-case-detection
description: Identify failure modes and uncommon but relevant paths.
model_tier: reasoning
triggers:
  - process_depth:
      - graduated lane
      - full lane
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
    description: Scoped request or solution summary.
  acceptance_criteria_path:
    type: path
    required: false
    description: Acceptance criteria artifact for edge-case evaluation.
---

## What It Does

Finds missing failure modes, uncommon paths, and state transitions that would materially affect requirements, design, implementation, or verification if ignored.

## Use This When

Use this during planning, design, or review when the work changes user flows, data transitions, or operational behavior and the happy path is already understood.

## Inputs

- Read the request, acceptance criteria, and proposed solution first.
- Read canonical docs that describe current states or interfaces for the affected module.
- Read `references/edge-case-categories.md` and the shared coding checklist before producing findings.

## Procedure

1. Enumerate the primary flow as a baseline.
2. Walk every category in `assets/categories.txt` (empty, stale, loading, retry, permission, concurrency, rollback, integration, overflow, state-skip) against the request.
3. Keep only cases that materially change behavior, docs, or verification scope.
4. Tie each case to the artifact that absorbs it (requirements, UX states, AC, tests, rollback plan).
5. Format per `assets/output.template.md`; validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Edge Cases` + per-case `### ...` with `Scenario:`, `Why It Matters:`, `Apply To:` lines.
- When nothing additional is found, output the literal `No Additional Edge Cases` (with no other content).
- Output must pass `scripts/lint-output.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when current behavior is undocumented and edge-case expectations depend on product policy.
- Warn when a missing case implies unrecoverable data loss or customer-facing failure.
- Do not add theoretical scenarios that are not credible for the current request.

## Resources

- `references/edge-case-categories.md`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/categories.txt`
- `runtime/capabilities/coding/checklists/edge-cases-coding.md`
- `agents/openai.yaml`
