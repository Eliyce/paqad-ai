# Logging Gaps Checklist

## Repudiation Risk Matrix

For each sensitive operation, verify an audit record exists with all four of: **who** (actor identity), **what** (operation + resource), **when** (timestamp), **from where** (IP address / request ID).

| Operation                                  | Minimum Log Fields                                                       | Compliance Flag |
| ------------------------------------------ | ------------------------------------------------------------------------ | --------------- |
| Successful login                           | user_id, IP, timestamp, auth method                                      | Required        |
| Failed login                               | username (not password), IP, timestamp, failure reason                   | Required        |
| Password change                            | user_id, IP, timestamp                                                   | Required        |
| MFA enrollment / removal                   | user_id, IP, timestamp, device                                           | Required        |
| Session invalidation (logout)              | user_id, session_id, timestamp                                           | Required        |
| Access denied (403)                        | user_id, requested_resource, IP, timestamp                               | Required        |
| Privilege escalation attempt               | user_id, target_privilege, IP, timestamp                                 | Required        |
| Financial transaction                      | actor, amount, currency, destination, transaction_id, timestamp          | Compliance      |
| Data export / bulk download                | actor, record_count, filters, IP, timestamp                              | Compliance      |
| Admin operation (user delete, role change) | admin_id, target_user, operation, IP, timestamp                          | Compliance      |
| Configuration change                       | admin_id, changed_key, old_value (masked), new_value (masked), timestamp | Compliance      |

## Log Injection Test

Can an attacker inject fake log entries or corrupt log format?

**Test 1 — Newline injection (line-based log formats):**

- Set username to: `admin\n2026-01-01 00:00:00 INFO Login success user_id=1 ip=127.0.0.1`
- If the application logs `"Login attempt: {username}"` → attacker creates a fake success entry above the real failure entry.

**Test 2 — JSON log corruption:**

- Set a user-controlled field to: `","is_admin":true,"x":"`
- If the application builds a JSON log string via string concatenation → the JSON structure is corrupted.

**Test 3 — ANSI escape injection (terminal log viewers):**

- Set input to: `\x1b[2J` (clear screen) or `\x1b[31m` (red text)
- Affects developers reading logs in terminals; can hide log entries.

**Safe mitigation:** Sanitize user input before logging (strip/escape `\n`, `\r`, `\x1b`); use structured logging libraries that serialize fields safely (pino, winston JSON transport, structlog, Monolog JSON formatter).

## Sensitive Data in Logs

**Never log:**

- Passwords or password hashes (even failed login attempts — log username only)
- Authentication tokens (JWT, session ID, OAuth tokens)
- Full credit card numbers (log last 4 digits maximum)
- CVV / CVC codes
- Full SSN, passport numbers, or government IDs (log first/last digits maximum)
- Private encryption keys or HMAC secrets

**Common accidental leaks to check:**

- Request body logged wholesale (check Express/Laravel/Django debug logging middleware)
- Error messages that include the original SQL query (contains user data)
- `console.log(req.body)` or `dd($request->all())` left in production code
- Exception traces that include function arguments (passwords passed as arguments)

## Minimum Security Logging Standard (OWASP ASVS 7.1)

The following events must be logged in any security-compliant application:

1. All authentication events (success, failure, lockout)
2. All access control failures
3. All server-side input validation failures
4. All high-value transactions with actor context

If any of these four are absent, record as a `logging-monitoring` finding with `impact: medium`.

## GDPR / Data Retention Note

Logs containing user PII (IP addresses, usernames, email addresses) are subject to GDPR Article 5(1)(e) — data minimization and storage limitation. Verify:

- Logs with PII have a defined retention period (typically 30–90 days)
- Logs are not indefinitely retained by default
- Log access is restricted to authorized personnel
