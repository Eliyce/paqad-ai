---
name: auth-mechanism-review
description: Reason about authentication weaknesses including JWT vulnerabilities, session security, OAuth/OIDC flaws, brute-force surfaces, and password storage from code and docs evidence.
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
    description: Module docs describing authentication flows, sessions, and token handling.
  test_paths:
    type: path[]
    required: false
    description: Tests that may prove authentication mechanism security.
---

## What It Does

Reviews authentication implementation for weaknesses that let an attacker bypass identity verification — JWT algorithm confusion, session fixation, OAuth redirect manipulation, brute-force surfaces, and weak password storage — producing findings backed by code or test evidence.

## Use This When

Use this when module docs or route inventories describe login flows, session management, token issuance/validation, OAuth/OIDC callbacks, password reset flows, or MFA enforcement.

## Inputs

- Read the module docs describing authentication and session flows.
- Read `references/auth-attack-checklist.md` before evaluating each area.
- Read code files and tests that show JWT validation, session handling, and rate limiting.

## Procedure

1. **JWT review**: Find JWT validation code. Check:
   - Algorithm is verified; `alg:none` is explicitly rejected
   - RS256 public key is not reused as HMAC secret (RS256 → HS256 confusion attack)
   - Token expiry (`exp`) is enforced; refresh token rotation is implemented
   - `kid` header is not used in a file path or SQL lookup without sanitization
   - JWT secret is not a weak/guessable string (`secret`, `password`, `key`, `123456`)
   - `aud` and `iss` claims are validated

2. **Session review**: Check:
   - Session fixation protection: session ID is regenerated after successful authentication
   - `Secure` + `HttpOnly` + `SameSite=Strict` cookie flags
   - Session invalidation on both logout and password change
   - Absolute session timeout (not just sliding window)

3. **Token storage**: Find client-side token storage. `localStorage` or `sessionStorage` are accessible to XSS; `HttpOnly` cookies are not. Verify refresh tokens are stored separately from access tokens. Check that a token revocation mechanism exists.

4. **Brute-force protection**: Find login, password reset, and OTP verification endpoints. Check for:
   - Per-IP or per-account rate limiting
   - Account lockout after N failures
   - Username enumeration via response timing or different error messages ("user not found" vs "wrong password")

5. **Password policy**: Check:
   - Hashing algorithm: `bcrypt` / `argon2` / `scrypt` vs `MD5` / `SHA1` / `SHA256` without cost factor
   - Salt uniqueness per password (not a global salt)
   - bcrypt cost factor ≥ 10; argon2 memory ≥ 64MB; PBKDF2 ≥ 100k iterations
   - Breached password detection (HIBP-style check or equivalent)

6. **OAuth / OIDC review**: Check:
   - `state` parameter is present and validated on the callback (CSRF protection)
   - Authorization code flow is used, not implicit flow
   - Redirect URI is strictly validated — no wildcard, no open redirect via callback
   - PKCE is enforced for public clients (mobile, SPA)
   - Token scopes are properly minimized (principle of least privilege)

## Output Contract

- Match `assets/output.template.md`: `## Findings` heading, one bullet per weakness with severity, WSTG id (from `assets/wstg-mapping.txt`), `Evidence: file:line`, and `Required action:`.
- Output must pass `scripts/lint-findings.sh` (exit 0).
- Run `scripts/scan-auth-smells.sh` before drafting; treat each emitted hit as an investigation candidate, not an automatic finding.

## Escalate / Stop Conditions

- Ask when the auth library in use is not identified — cannot verify JWT validation without knowing the library.
- Warn when `alg:none` is not explicitly blocked and the framework does not reject it by default.
- Do not mark authentication as safe purely because a login endpoint exists — each of the 6 areas must be verified independently.

## Resources

- `references/auth-attack-checklist.md`
- `scripts/scan-auth-smells.sh` — pre-investigation grep over the codebase
- `scripts/lint-findings.sh` — enforces WSTG id + Evidence citation per finding
- `assets/output.template.md`
- `assets/wstg-mapping.txt` — area → WSTG test id lookup
