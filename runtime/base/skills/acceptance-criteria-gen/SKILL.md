---
name: acceptance-criteria-gen
description: Generate acceptance criteria tied to observable outcomes.
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
    description: Scoped request or story to convert into acceptance criteria.
  constraints_path:
    type: path
    required: false
    description: Optional canonical constraints document.
---

## What It Does

Turns a scoped request into testable acceptance criteria that describe observable behavior, guardrails, and failure handling without relying on implied implementation details.

## Use This When

Use this when a request is entering planning or solutioning and the current brief has goals but not enough precise behavior to verify. It is especially important before stories, test mapping, or handoff artifacts are written.

## Inputs

- Read the active request, tracker entry, or plan summary first.
- Read the canonical module docs or feature spec that defines the current behavior.
- Read `references/criteria-template.md` before drafting criteria so wording stays consistent.

## Procedure

1. Run `scripts/extract-ac-ids.sh <spec-file>` to get the set of AC ids already taken; never reuse a removed id.
2. For each new criterion, run `scripts/next-ac-id.sh <spec-file> [fr-number]` to allocate the next free id.
3. List the user-visible outcomes and constraints; convert each into observable Given/When/Then prose using `assets/output.template.md` as the shape.
4. Add negative, empty, stale, retry, or permission criteria only when the request changes those paths. Drop criteria that describe implementation choices instead of behavior.
5. Validate the draft with `scripts/lint-ac-output.sh <draft-file>` — exit 0 means the structural contract is met; non-zero means fix and re-lint before returning.

## Output Contract

- Match `assets/output.template.md` exactly: `## Acceptance Criteria` heading, `### AC-...` per criterion with Given/When/Then on the next line, ending `## Coverage Notes` block.
- Use `AC-{fr}.{n}` two-level identifiers when a parent FR is provided; fall back to `AC-{n}` only when no FR context exists, and note this in Coverage Notes.
- Identifiers must be stable across spec revisions — removed criteria do not have their identifier reused.
- The output must pass `scripts/lint-ac-output.sh` with exit 0 before returning.

## Escalate / Stop Conditions

- Ask for clarification when the request does not define the actor, trigger, or expected result.
- Warn when canonical docs conflict with the requested behavior and note the drift explicitly.
- Stop short of inventing hidden business rules; record the gap instead.

## Resources

- `references/criteria-template.md`
- `scripts/extract-ac-ids.sh`
- `scripts/next-ac-id.sh`
- `scripts/lint-ac-output.sh`
- `assets/output.template.md`
- `runtime/capabilities/coding/checklists/edge-cases-coding.md`
- `agents/openai.yaml`
