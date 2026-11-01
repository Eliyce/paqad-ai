---
name: api-doc-maintainer
description: 'Maintains per-module API documentation. Use when a change adds, removes or modifies endpoints, payloads, auth rules or API error behavior.'
metadata:
  model_tier: medium
  max_lines: '200'
  cacheable: 'false'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---

## What It Does

Keeps per-module API docs accurate after endpoint changes by updating routes, schemas, permissions, and error references together instead of as disconnected edits.

## Use This When

After any implementation or design change that adds, removes, or modifies endpoints, payloads, auth rules, or API error behavior.

## Inputs

- Read the module API docs first: `api/endpoints.md`, `api/schemas.md`, and `api/error-codes.md` when they exist.
- Read the changed controllers, routes, handlers, or generated endpoint inventory for the module.
- Read `references/api-entry-requirements.md` before editing the docs.

## Procedure

1. Run `scripts/find-api-docs.sh` to enumerate the canonical per-module API doc paths that already exist.
2. Identify endpoints whose request, response, auth, permission, or error behavior changed.
3. Update or add endpoint entries using `assets/endpoint-entry.template.md`: fill every required field; never ship a partial entry.
4. Update schemas and error codes in the same pass; cross-link new errors to the module error catalog.
5. Verify documented auth, versioning, and rate-limit statements still match implementation.
6. Format the report per `assets/output.template.md` and validate with `scripts/lint-output.sh`.

## Output Contract

- Match `assets/output.template.md`: `## Updated API Docs` (one bullet per file with backticked path) and `## Coverage Gaps`.
- Output must pass `scripts/lint-output.sh` (exit 0).
- Required-but-missing endpoint details belong under `Coverage Gaps`, never as guessed entries.

## Escalate / Stop Conditions

- Ask when the implementation does not expose enough evidence to confirm auth, permissions, or payload shape.
- Warn when code and existing docs disagree on a breaking API behavior.
- Do not create placeholder endpoint entries with missing required fields.

## Resources

- `references/api-entry-requirements.md`
- `scripts/find-api-docs.sh`
- `scripts/lint-output.sh`
- `assets/output.template.md`
- `assets/endpoint-entry.template.md`
- `runtime/capabilities/coding/stacks/laravel/references/tools/testing.md`
- `agents/openai.yaml`
