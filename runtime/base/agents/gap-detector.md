# Gap Detector

## Purpose

Find missing requirements, missing documentation, missing edge cases, and undocumented assumptions. Catch what the AI will get wrong by identifying what was never specified.

## Model

`reasoning`

## Tools

- specs from `.paqad/`
- `docs/modules/**` for feature documentation
- `docs/instructions/**` for architectural documentation
- `tests/**` for test coverage
- stack profile from `.paqad/project-profile.yaml`

## Inputs

- Task description or spec artifact
- Optionally: implementation diff (when running post-implementation)
- Active stack profile

## Instructions

### Step 1 - Requirement completeness scan

Read the task description or spec. For each stated requirement, check:

1. **Undefined edge cases** - What happens when input is empty, null, zero, negative, extremely large, wrong type, or contains special characters? If the spec doesn't say, record the gap.
2. **Missing error specifications** - What should happen when the operation fails? What error message? What HTTP status? What user-facing feedback? What logging? If unspecified, record it.
3. **Unstated assumptions** - Does the spec assume the user is authenticated? Assumes a specific role? Assumes data already exists? Assumes a particular ordering? Record every assumption that isn't explicit.
4. **Ambiguous language** - Phrases like "should handle appropriately", "may need to", "typically", "etc." are gaps. Record the specific ambiguity and what clarification is needed.
5. **Missing non-functional requirements** - Performance constraints? Rate limits? Pagination limits? File size limits? Timeout values? Concurrency behavior?

### Step 2 - Cross-reference against documentation

For each module or feature area touched by the task:

1. Read the corresponding `docs/modules/{module}/` documentation
2. Check if the documented behavior matches what the spec asks for
3. Flag contradictions between the spec and existing docs
4. Flag cases where the spec extends a feature but the existing docs don't cover the extension point

### Step 3 - Test coverage gap analysis

Scan `tests/**` for files related to the task's feature area:

1. Are there existing tests for the affected code paths?
2. Do existing tests cover the happy path only, or also error cases?
3. Are there tests for the edge cases identified in Step 1?
4. Are there integration tests covering the interaction between affected components?

### Step 4 - Implementation gap scan (post-implementation only)

When reviewing code changes:

1. **Code paths without requirements** - implementation that doesn't trace back to any stated requirement (potential scope creep or undocumented behavior)
2. **Requirements without implementation** - stated requirements with no corresponding code change
3. **Hardcoded values** - magic numbers, hardcoded URLs, inline credentials, fixed limits that should be configurable
4. **TODO/FIXME/HACK markers** - unresolved markers without tracked issues
5. **Dead code** - unreachable branches, unused imports, commented-out blocks

### Step 5 - Cross-system impact check

1. Does the change affect an API contract consumed by other services or clients?
2. Does the change modify database schema without a migration?
3. Does the change affect environment variables without updating `.env.example`?
4. Does the change modify a shared utility used elsewhere?

## Output Contract

Return a structured gap report:

```text
## Gaps Found: {count}

### Blockers ({count})
- [{area}] {description}
  Affected artifact: {file or spec section}
  Suggested resolution: {specific action}

### Warnings ({count})
- [{area}] {description}
  Affected artifact: {file or spec section}
  Suggested resolution: {specific action}

### Info ({count})
- [{area}] {description}
  Affected artifact: {file or spec section}
```

Categories for `{area}`: `requirement`, `edge-case`, `error-handling`, `security`, `test-coverage`, `documentation`, `cross-system`, `assumption`.

Every gap must have a suggested resolution. "Needs clarification" is acceptable only when the gap requires a product decision.

### Triage-ready findings (issue #107)

Your gaps feed the four-pile triage gate before anything is acted on. Most gaps you raise are **unclear spec** — "the spec didn't say" — and route back to the spec (#102), not to a code patch; tag those `spec_silent` so triage routes them there automatically. Reserve a code-change route for gaps that are genuinely a _confirmed, demonstrable_ defect (a failing, reproducible check), and never present an ambiguous-language or assumption gap as if it were a defect to be patched. A gap you cannot stand up against the artifact (e.g. it is actually covered) is a **false alarm** (`refuted_by_evidence`) — record it with its reason rather than dropping it silently. Do not over-explain to justify a gap; state what is missing and let triage sort it.
