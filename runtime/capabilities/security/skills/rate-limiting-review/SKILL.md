---
name: rate-limiting-review
description: Identify missing rate limiting and denial-of-service surfaces on authentication endpoints, bulk operations, expensive queries, and WebSocket handlers.
model_tier: medium
triggers:
  - workflow:
      - pentest
cacheable: false
cache_key_inputs:
  - docs/modules/**
  - tests/**
output_format: markdown
input_schema:
  module_doc_paths:
    type: path[]
    required: true
    description: Module docs describing API endpoints, authentication flows, and bulk operations.
  test_paths:
    type: path[]
    required: false
    description: Tests that may prove rate limiting or throttle enforcement.
---

## What It Does

Reviews the application for endpoints and operations that lack rate limiting, creating denial-of-service or brute-force surfaces. Maps to OWASP API Security Top 10 2023 #4 — Unrestricted Resource Consumption.

## Use This When

Use this when module docs or route inventories describe authentication endpoints, registration flows, OTP/MFA verification, password resets, data export endpoints, bulk operations, or any endpoint that triggers expensive backend work.

## Inputs

- Read module docs to identify high-risk endpoint categories.
- Read `references/rate-limit-signals.md` for per-framework absence patterns.
- Read routing and middleware configuration files.

## Procedure

1. **Authentication-sensitive endpoints**: Find `/login`, `/register`, `/reset-password`, `/verify-otp`, `/resend-otp`, `/verify-email`. Check for `throttle`, `rate_limit`, `limiter`, `RateLimit` middleware on each. Missing rate limiting enables credential stuffing and OTP brute-force.

2. **Bulk / export endpoints**: Find `/export`, `/bulk`, `/download`, `/import`, `/batch`. Check for per-user quotas, record-count limits, and size limits. Missing limits enable data exfiltration and DB overload.

3. **Expensive operations**: Find endpoints that trigger N+1 queries, ML inference calls, PDF generation, email sending, or large file processing. Check for job queuing or concurrency caps. Missing controls enable CPU/memory exhaustion.

4. **WebSocket handlers**: Check for per-connection message rate limits. Missing limits enable message flooding.

5. **Unauthenticated expensive endpoints**: Identify unauthenticated endpoints that trigger expensive backend work (e.g., search across all records, asset resize on upload, public preview generation). These are the highest DoS risk because no authentication barrier exists.

6. **Pagination limits**: Find list endpoints that accept a `per_page`, `limit`, or `page_size` parameter. Check for a maximum cap (e.g., max 100 records per page). Missing caps enable database full-table scans via `?per_page=999999`.

## Output Contract

- Match `assets/output.template.md`: severity, WSTG id, category from `assets/category-rubric.txt`, Evidence: `file:line`, Required action.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when routing configuration is not accessible — cannot enumerate endpoints without it.
- Warn when authentication endpoints have no rate limiting at all — this is a critical gap enabling automated attacks.
- Do not flag rate limiting gaps on read-only, public, lightweight endpoints with no meaningful abuse potential.

## Resources

- `references/rate-limit-signals.md`
- `scripts/scan-rate-limit.sh` — surfaces sensitive endpoints + presence of throttle middleware
- `scripts/lint-findings.sh` — enforces WSTG-INPV-13/ATHN id + Evidence + Required action
- `assets/output.template.md`
- `assets/category-rubric.txt`
