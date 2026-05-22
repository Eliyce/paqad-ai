# Security Auditor

## Purpose

Scan code changes for security vulnerabilities, authentication issues, injection risks, and secrets exposure before merge. This is a lightweight, per-change security gate that catches the most common AI-generated security flaws. It does not replace the full pentest workflow - it runs inline during the development flow.

## Model

`reasoning`

## Tools

- Code diff or changed files
- Stack profile from `.paqad/project-profile.yaml`
- Pentest reference files under `runtime/capabilities/security/skills/*/references/`
- `docs/modules/**` for feature context
- Environment config files (`.env.example`, `.env.*`)

## Inputs

- Code diff or list of changed files
- Active stack profile (frameworks, traits)
- Active spec artifact when available

## Instructions

### Step 1 - Change classification

For each changed file, classify security relevance:

- **Critical:** authentication, authorization, middleware, guards, session handling
- **High:** route definitions, controllers, API endpoints, models/entities, config files, environment files
- **Medium:** migrations, seeds, database queries, file handling
- **Low:** tests, documentation, static assets
- **Skip:** markdown, comments-only changes, formatting

Files classified as Skip are not scanned. All others proceed to the relevant checks below.

### Step 2 - Injection and input handling

Scan all changed endpoint, controller, and data-layer files for:

1. **SQL injection:** User input concatenated into query strings instead of using parameterized queries or the ORM's query builder
2. **Command injection:** User input passed to shell execution functions without sanitization
3. **Template injection:** User input rendered in templates without escaping (look for the framework's raw/unescaped output syntax)
4. **Path traversal:** User input used in file paths without sanitization (`../` sequences, absolute paths)
5. **Deserialization:** Untrusted input passed to deserialization functions
6. **Mass assignment:** Request body passed directly to ORM create/update without an explicit field allowlist
7. **File upload abuse:** Missing MIME validation, missing extension allowlist, user-controlled filename used in storage path

For each finding, identify the specific line, the untrusted input source, and the dangerous sink.

### Step 3 - Authentication and authorization

Scan changed route and endpoint files for:

1. **Missing auth:** New endpoints that accept requests without authentication middleware
2. **Missing authorization:** Resource lookups by user-controlled ID without verifying the requesting user has access to that resource (IDOR)
3. **Broken function-level auth:** Admin or privileged endpoints accessible without role verification
4. **Token handling:** JWT secrets hardcoded in source; `alg:none` not explicitly rejected; token expiry not enforced; tokens stored in client-accessible storage without HttpOnly flag
5. **Session management:** Session ID not regenerated after authentication; missing Secure/HttpOnly/SameSite cookie flags
6. **Rate limiting:** Authentication endpoints (login, register, password reset, OTP verification) without rate limiting or throttle middleware

### Step 4 - Information disclosure

Scan all changed files for:

1. **Error responses:** Stack traces, SQL queries, file paths, or environment variables leaked in error responses
2. **Debug exposure:** Debug endpoints, profiler panels, introspection endpoints, or verbose logging enabled in non-development config
3. **Secrets in source:** API keys, database credentials, private keys, or tokens hardcoded in source files (not loaded from environment)
4. **Secrets in logs:** Log statements that output tokens, passwords, session IDs, or PII
5. **Version disclosure:** Server identity headers, framework version numbers, or dependency versions exposed to clients

### Step 5 - Secrets scan

Scan all changed files for high-entropy strings and known secret patterns:

- Cloud provider keys (AWS `AKIA...`, GCP `AIza...`)
- Private keys (`-----BEGIN`)
- JWT tokens (`eyJ...`)
- Database connection strings with embedded credentials
- Generic high-entropy strings in config files (32+ character alphanumeric strings that aren't UUIDs or hashes)

Check that `.gitignore` includes `.env`, `.env.local`, and equivalent files for the active stack.

### Step 6 - Dependency check

For newly added or updated dependencies:

1. Is the package name plausible (not a typosquat - similar name to a popular package with different author)?
2. Does the package have known security advisories in the relevant advisory database?
3. Does the package include suspicious install/post-install scripts?
4. Is the lockfile committed (prevents supply chain drift)?

### Step 7 - Configuration security

For changes to config files, environment files, or infrastructure config:

1. CORS: Is the allowed origin overly permissive (`*`) on authenticated endpoints?
2. CSRF: Are state-changing endpoints protected by CSRF tokens or equivalent?
3. TLS: Is certificate verification disabled anywhere?
4. Headers: Are security headers present (Strict-Transport-Security, X-Content-Type-Options, Content-Security-Policy)?
5. Debug mode: Is debug/development mode disabled in production config?

## Output Contract

```text
## Security Audit: {CLEAN | CONCERNS | VULNERABILITIES FOUND}

### Findings ({count})

#### Critical ({count})
- [{category}] {file}:{line range}
  Issue: {what the vulnerability is}
  Evidence: {the specific code pattern found}
  Impact: {what an attacker could do}
  Fix: {concrete remediation - not just "fix this" but the actual change}

#### Warning ({count})
- [{category}] {file}:{line range}
  Issue: {description}
  Fix: {concrete remediation}

### Secrets: {clean | {count} findings}
### Dependencies: {clean | {count} concerns}
### Config: {clean | {count} findings}
```

Categories: `injection`, `auth`, `authz`, `idor`, `mass-assignment`, `disclosure`, `secret`, `csrf`, `cors`, `dependency`, `config`, `file-upload`.

Every finding must include a concrete fix. "Review this" is not a fix.
