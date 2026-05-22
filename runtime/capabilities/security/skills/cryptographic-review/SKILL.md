---
name: cryptographic-review
description: Identify cryptographic failures including weak hashing, insecure encryption modes, hardcoded keys, weak PRNG usage, and disabled TLS verification from code evidence.
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
    description: Module docs describing data storage, encryption, token generation, and external communication.
  test_paths:
    type: path[]
    required: false
    description: Tests that may prove cryptographic strength or key management.
---

## What It Does

Reviews the application's cryptographic implementation for weaknesses that could allow an attacker to recover sensitive data, forge tokens, or intercept communications — covering password storage, symmetric encryption, random number generation, key management, and TLS configuration. Maps to OWASP 2025 A04 — Cryptographic Failures.

## Use This When

Use this when module docs or code evidence describes password storage, data encryption, token generation, API key creation, external HTTPS calls, or certificate/key management.

## Inputs

- Read module docs to identify where cryptography is used.
- Read `references/crypto-weakness-patterns.md` before scanning each area.
- Read code and configuration files for cryptographic implementation details.

## Procedure

1. **Encryption at rest**: Find database columns or file stores that contain PII, financial data, authentication credentials, or health records. Verify encryption is applied and the encryption key is not stored in the same location as the encrypted data.

2. **Encryption in transit**: Verify all inter-service and client-server communication uses TLS 1.2+. Search for patterns that disable certificate verification: `verify=False`, `rejectUnauthorized: false`, `InsecureSkipVerify: true`, `CURLOPT_SSL_VERIFYPEER = false`, `ssl._create_unverified_context()`, `NODE_TLS_REJECT_UNAUTHORIZED=0`.

3. **Key management**: Scan codebase for hardcoded secrets, API keys, or encryption keys embedded as string literals or in config files committed to the repository. Verify that key rotation procedures exist. Verify keys are not stored alongside the data they protect.

4. **Password storage**: Identify the hashing algorithm used for passwords:
   - `MD5`, `SHA1`, `SHA256` (even with salt) → flag as weak for password hashing; fast algorithms enable brute-force
   - `bcrypt` with cost factor ≥ 10 → acceptable
   - `argon2id` with memory ≥ 64MB, iterations ≥ 3 → recommended
   - `PBKDF2` with ≥ 100,000 iterations → acceptable
   - Check that each password has a unique random salt (not a global salt)

5. **Random number generation**: Find uses of `Math.random()`, `rand()`, `mt_rand()`, `random.random()`, `java.util.Random` in security-sensitive contexts (session ID generation, token generation, OTP generation, CSRF token generation). These are not cryptographically secure. Require `crypto.randomBytes()`, `random_bytes()`, `secrets.token_bytes()`, `java.security.SecureRandom`.

6. **Symmetric encryption**: Find uses of ECB mode (`AES/ECB`, `openssl_encrypt(..., "aes-128-ecb", ...)`). ECB mode leaks patterns in ciphertext — identical plaintext blocks produce identical ciphertext. Check for static/hardcoded IVs. Verify IVs are generated with a CSPRNG per encryption operation.

## Output Contract

- Match `assets/output.template.md`: `## Findings` with severity, WSTG-CRYP id (from `assets/wstg-mapping.txt`), `Evidence: file:line`, and `Required action:` per bullet.
- Output must pass `scripts/lint-findings.sh` (exit 0).
- Never include raw secret values — `file:line` only.

## Escalate / Stop Conditions

- Ask when the encryption library is not identified — cannot verify algorithm without knowing the library.
- Warn when `MD5` or `SHA1` is used anywhere for password hashing — these are never acceptable regardless of salt.
- Do not flag cryptography findings for non-security data (e.g., MD5 used for cache key generation or file checksums is acceptable).

## Resources

- `references/crypto-weakness-patterns.md`
- `scripts/scan-crypto-smells.sh` — pre-investigation grep for known anti-patterns
- `scripts/lint-findings.sh` — enforces WSTG-CRYP id, Evidence:file:line, and no raw-secret leak
- `assets/output.template.md`
- `assets/wstg-mapping.txt`
