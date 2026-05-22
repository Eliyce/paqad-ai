# Auth Attack Checklist

Concrete attack scenarios. For each item, check whether the application's implementation would block it.

## JWT Attacks

### alg:none Bypass

1. Take a valid JWT token.
2. Decode the header, change `"alg"` to `"none"`.
3. Re-encode header + original payload as base64url.
4. Send `<new_header>.<original_payload>.` (empty signature).
5. **Expected**: 401. If the server accepts it → JWT signature not verified.

### RS256 → HS256 Confusion

1. Obtain the server's RS256 public key (often exposed at `/jwks.json` or in cert).
2. Use the **public key bytes** as the HMAC secret to sign a modified payload with `"alg":"HS256"`.
3. **Expected**: 401. If the server accepts it → the library does not pin the expected algorithm.

### Weak Secret Brute-Force

- JWT secrets like `secret`, `password`, `key`, `changeme`, or short alphanumeric strings can be brute-forced with `hashcat` or `jwt_tool`.
- Check: is the secret at least 32 bytes of random entropy?

### kid Header Injection

- If the `kid` header is used in a file lookup: `"kid": "../../dev/null"` — server reads empty file as key, accepting any signature.
- If used in a SQL query: `"kid": "x' UNION SELECT 'attackerkey'--"`.

## Session Attacks

### Session Fixation

1. Obtain a session ID from the application before logging in (e.g., from `Set-Cookie`).
2. Complete the login flow while retaining the pre-auth session ID.
3. **Expected**: session ID changes after login. If it stays the same → session fixation.

### Cookie Security Flags

- Missing `HttpOnly`: `document.cookie` can be read via XSS.
- Missing `Secure`: cookie sent over HTTP.
- Missing `SameSite`: cross-site requests can include the cookie (CSRF surface).

### Session After Logout

1. Capture a valid session token.
2. Log out.
3. Reuse the captured token.
4. **Expected**: 401. If server still accepts it → session not invalidated on logout.

## OAuth / OIDC Attacks

### CSRF on OAuth Callback

- The `state` parameter must be generated per-session and validated on callback.
- If absent or not validated: attacker can force-complete an OAuth flow with a victim's credentials.

### Open Redirect via Redirect URI

- Test `?redirect_uri=https://evil.com` or `?redirect_uri=https://legit.com.evil.com/callback`.
- **Expected**: rejected. If the server accepts partial matches → authorization code delivered to attacker.

### Password Reset Poisoning

- Tamper the `Host` header during a password reset request: `Host: evil.com`.
- If the application uses `Host` to construct the reset link → link delivered to victim contains attacker domain.

### Implicit Flow

- If the application uses implicit flow (`response_type=token`), the access token appears in the URL fragment and can leak via `Referer` headers or browser history.

## Brute-Force Surfaces

- `/login` without rate limit → credential stuffing
- `/reset-password` without rate limit → password reset token enumeration
- `/verify-otp` without rate limit → OTP brute-force (6-digit OTP = 1,000,000 combinations)
- Username enumeration: "user not found" vs "wrong password" reveals valid usernames

## MFA Bypass

1. Complete login up to the MFA challenge step.
2. Directly call the post-MFA endpoint (the endpoint that normally follows MFA success) without providing the MFA code.
3. **Expected**: rejected. If the server accepts it → MFA is not enforced on the protected endpoint.
