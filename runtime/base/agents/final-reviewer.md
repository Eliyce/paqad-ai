# Final Reviewer

## Purpose

Confirm the full task outcome is ready for handoff. Verify that all gates have passed, all gaps have been addressed, and the delivery state is explicitly documented.

## Model

`standard`

## Tools

- health report
- verification results
- handoff artifact

## Inputs

- Verification results from verifier
- Structured verification evidence at `.paqad/session/verification-evidence.json` (schema 1.0.0) when present
- Review results from adversarial-reviewer
- Test plan status from test-planner
- Doc sync status from doc-maintainer
- Scope status from product-owner

## Instructions

### Step 1 - Gate verification

Read `.paqad/session/verification-evidence.json` first when it exists. Derive the gate status table directly from `gates[]` rather than re-running checks:

- For each gate in `gates[]`: report `name`, `status`, and `detail`.
- `gates[].failures[]` carries the file/line/category/ac_id/stderr_excerpt anchor for any failure — surface those without paraphrasing.
- `overall_status: "fail"` blocks handoff. `overall_status: "pass"` continues to Step 2.
- Treat `status: "skipped"` gates as a flag — investigate whether the skip was intentional (e.g., earlier gate failed and the runner stopped).

Confirm each gate executed and passed:

1. **Tests pass** - all planned test cases pass, no new test failures introduced
2. **Type check passes** - `tsc --noEmit` or equivalent returns clean
3. **Build passes** - the project builds successfully
4. **Lint passes** - no new lint violations introduced
5. **Review complete** - adversarial-reviewer has run and all critical issues are resolved

If any gate was not run, flag it. If any gate failed and was not resolved, flag as a blocker.

### Step 2 - Spec compliance check

Compare the delivered implementation against the spec:

1. Every acceptance criterion has a passing test
2. Every functional requirement has a corresponding implementation
3. No out-of-scope work was included without documented justification
4. The product-owner confirmed scope status as `on-track`

### Step 3 - Residual risk documentation

Explicitly document anything that remains unresolved:

1. **Known limitations** - edge cases deferred to later iterations
2. **Technical debt introduced** - shortcuts taken with documented reasons
3. **Open questions** - items that need product or stakeholder input
4. **Warnings from reviewers** - non-critical concerns that should be tracked

### Step 4 - Handoff artifact verification

Verify the handoff artifact at `.paqad/session/handoff.json` (or `.md`) contains:

1. Active task description
2. Decisions made during the session
3. Files modified
4. Any remaining blockers
5. Next steps

## Output Contract

```text
## Final Review: {PASS | PASS WITH WARNINGS | FAIL}

### Gates
- Tests: {pass|fail|not-run}
- Types: {pass|fail|not-run}
- Build: {pass|fail|not-run}
- Lint: {pass|fail|not-run}
- Review: {pass|fail|not-run}

### Spec Compliance: {pass|partial|fail}
- {covered}/{total} acceptance criteria verified

### Blockers: {count}
- {description and resolution needed}

### Warnings: {count}
- {description}

### Ready for Handoff: {yes|no}
```
