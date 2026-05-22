---
name: logging-monitoring-review
description: Assess security logging and monitoring gaps including missing audit trails, log injection surfaces, sensitive data in logs, and alerting coverage.
model_tier: reasoning
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
    description: Module docs describing sensitive operations, financial actions, and authentication flows.
  test_paths:
    type: path[]
    required: false
    description: Tests that may prove audit logging or log integrity.
---

## What It Does

Reviews whether the application logs security-relevant events with sufficient context for incident detection and forensic analysis — and whether the logging itself is secure (no sensitive data in logs, no log injection surfaces). Maps to OWASP 2025 A09 — Security Logging and Alerting Failures.

## Use This When

Use this when module docs describe authentication, authorization decisions, financial transactions, data exports, admin operations, or any high-value action that must be auditable for compliance or incident response.

## Inputs

- Read module docs to identify which operations are high-value and must be audited.
- Read `references/logging-gaps-checklist.md` before evaluating each area.
- Read logging configuration files (Laravel `config/logging.php`, Django `LOGGING` dict, Express winston/pino config) and test files.

## Procedure

1. **Authentication event logging**: Check whether failed and successful login attempts are logged with IP address, timestamp, and username (not password). Check that password changes, MFA enrollment/removal, and session invalidations are also logged.

2. **Authorization event logging**: Check whether access denials (403 responses) are logged with the requested resource and caller identity. Check that privilege escalation attempts are detected and logged.

3. **Data modification logging**: For each create/update/delete operation on sensitive models (users, payments, permissions, audit records themselves), verify an audit log entry is written with actor identity. Financial transaction audit trails must be append-only and tamper-resistant.

4. **Log integrity**: Check whether logs can be tampered with by an application-level user (e.g., a normal user can delete their own activity logs). Check whether logs are stored on a separate system from the application server.

5. **Log injection**: Check whether user-supplied input is written directly into log strings without sanitization. An attacker controlling a username or message field can:
   - Insert fake log entries by embedding newlines (`\n`) in the input
   - Inject ANSI escape codes to corrupt terminal-based log viewers
   - Corrupt structured JSON log format by embedding `}` or `"` characters

6. **Sensitive data in logs**: Check log statements around authentication, payment, and data export endpoints. Look for: passwords, authentication tokens, credit card numbers, full PII (SSN, passport numbers), session IDs.

7. **Alerting coverage**: Check whether there is alerting configured for: repeated authentication failures from a single IP, admin operations outside business hours, unusual data export volumes, or security-relevant configuration changes.

## Output Contract

- Match `assets/output.template.md`: severity, WSTG id (`WSTG-ERRH-02` default), area from `assets/event-checklist.txt`, Evidence: `file:line` only (never log content), Required action.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when logging configuration is not accessible in the project — cannot evaluate log destinations or levels.
- Warn when financial transaction records lack an append-only audit trail — this is typically a compliance requirement, not just a security best practice.
- Do not flag logging gaps for non-sensitive operations (e.g., a missing log for a public read endpoint is not a security finding).

## Resources

- `references/logging-gaps-checklist.md`
- `scripts/scan-log-smells.sh` — pre-investigation grep for sensitive data and injection candidates
- `scripts/lint-findings.sh` — enforces WSTG id + Evidence:file:line per finding
- `assets/output.template.md`
- `assets/event-checklist.txt` — the 7-area walk required before drafting
